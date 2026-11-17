// extract_company_facts: deterministic, rule-based extraction from cleaned page text.
// No AI and no paid APIs. Every fact carries a verbatim sentence from the page as its quote,
// which evidence.ts verifies again before it is accepted.
import { normalizeCertName } from "@/lib/agent/evidence";
import { CERT_RE } from "@/lib/scraper/clean";
import type { PageType } from "@/lib/types";

export interface QuotedSignal { signal: string; quote: string }

export interface PageFacts {
  company_name: string | null;
  product_description: string | null;
  product_quote: string | null;
  is_software_product: "yes" | "no" | "unknown";
  software_quote: string | null;
  sells_to_businesses: "yes" | "no" | "unknown";
  buyer_quote: string | null;
  certifications_held: Array<{ name: string; quote: string }>;
  funding_stage: "pre_seed" | "seed" | "series_a" | "series_b" | "series_c" | "series_d_plus" | "unknown";
  funding_quote: string | null;
  open_roles: Array<{ title: string; quote: string }>;
  stated_open_role_count: number | null;
  role_count_quote: string | null;
  enterprise_signals: QuotedSignal[];
  compliance_signals: QuotedSignal[];
  /** Signs the company is far beyond Series C (public, acquired, "millions of users"). */
  late_stage_signals: QuotedSignal[];
}

export const emptyFacts = (): PageFacts => ({
  company_name: null, product_description: null, product_quote: null, is_software_product: "unknown", software_quote: null,
  sells_to_businesses: "unknown", buyer_quote: null, certifications_held: [], funding_stage: "unknown", funding_quote: null,
  open_roles: [], stated_open_role_count: null, role_count_quote: null, enterprise_signals: [], compliance_signals: [],
  late_stage_signals: [],
});

// ── vocabularies ─────────────────────────────────────────────────────────────
const SOFTWARE_YES = /\b(software|saas|platform|apis?|sdks?|cloud[- ]based|dashboards?|integrations?|automat\w*|no-code|low-code|workflows?|analytics|ai-powered|copilot|toolkit|app for|web app|mobile app|developer tools?)\b/i;
const SOFTWARE_NO = /\b(add to cart|shop now|free shipping|our menu|order online|book a table|our restaurant|law firm|digital agency|creative agency|marketing agency|consulting firm|our clinic|apparel|handmade|real estate agents?|property listings)\b/i;
const B2B_YES = /\b(teams|businesses|companies|enterprises?|organi[sz]ations|b2b|startups|smbs?|mid-market|workforce|employees|it admins?|developers|engineering teams|sales teams|finance teams|hr teams|security teams|customer success|revops|for (sales|marketing|engineering|finance|hr|it|security|legal|ops|operations|product|support|revenue|recruiting))\b/i;
const B2C_NO = /\b(for you and your family|your family|for your home|personal use|groceries|your pet|for kids|gamers|for individuals|consumers)\b/i;
const VENDOR_CERT_LANGUAGE = /\b(your (company|business|organi[sz]ation|team|customers)|you (must|need|should|can)|help(s|ing)? (you|teams|companies|customers)|get (you )?(soc|iso|certified|compliant)|become (soc|iso|compliant|certified)|achieve (soc|iso)|your (soc|iso|audit)|automate (soc|iso|compliance)|compliance automation|for your customers|in weeks|in days|frameworks? (we )?support)\b/i;
const SELF_CERT = new RegExp(
  `\\b(we are|we're|we have|we've|is|are|has been|have been|achieved|completed|successfully|maintains?|holds?|proud(ly)?|our)\\b[^.\\n]{0,60}(?:${CERT_RE.source})[^.\\n]{0,40}\\b(certified|compliant|attest\\w*|audit(ed)?|certification|report|accredited)\\b`,
  "i",
);
const FUNDING_CONTEXT = /\b(raised|raises|raising|funding|round|led by|backed|investment|investors|announc\w*|closes|closed|secures?|secured)\b/i;
const ROLE_WORD = /\b(engineer|developer|designer|manager|director|head of|lead|analyst|scientist|architect|specialist|representative|executive|consultant|recruiter|counsel|associate|intern|coordinator|administrator|officer|strategist|writer|marketer|sdr|bdr|account executive|vp|vice president|product owner|devops|sre)\b/i;
const NOT_A_ROLE = /\b(we|our|you|your|join|apply|benefits|perks|culture|values|why|how|see all|view all|open roles|positions|careers|jobs at|life at|learn more|read more)\b/i;
const SECURITY_ROLE = /\b(secur\w*|complian\w*|grc|risk|privacy|audit|trust|infosec)\b/i;

const ENTERPRISE_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /\benterprise\b[^.\n]{0,25}\b(plan|tier|pricing|edition|package)\b|\b(plan|tier)\b[^.\n]{0,15}\benterprise\b/i, label: "Enterprise plan / tier" },
  { re: /\b(sso|saml|scim)\b/i, label: "SSO / SAML for enterprise customers" },
  { re: /\b(contact sales|talk to sales|custom pricing|custom plan|custom quote|volume pricing|get a quote)\b/i, label: "Sales-led custom pricing" },
  { re: /\b(audit logs?|dedicated (customer success|success|account) manager|uptime sla|99\.9\d*%)\b/i, label: "Enterprise features (audit logs, SLA, dedicated manager)" },
  { re: /\b(fortune 500|fortune 1000|global 2000|enterprise customers|enterprises like|world'?s (largest|leading) (companies|brands))\b/i, label: "Sells to large enterprises" },
];
const COMPLIANCE_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /\bgdpr\b/i, label: "GDPR obligations mentioned" },
  { re: /\b(data processing (agreement|addendum)|\bdpa\b)/i, label: "Data Processing Agreement offered" },
  { re: /\b(security questionnaires?|vendor (risk|security) (review|assessment)s?|security reviews?)\b/i, label: "Security questionnaires / vendor reviews" },
  { re: /\b(soc ?2|iso ?27001)\b[^.\n]{0,30}\b(in progress|underway|on track|coming soon|working towards|pursuing)\b|\bworking towards\b[^.\n]{0,20}\b(soc ?2|iso ?27001)\b/i, label: "Certification in progress" },
  { re: /\bhipaa\b/i, label: "HIPAA obligations mentioned" },
  { re: /\b(penetration test(ing)?|pen test|encrypt(ed|ion) (at rest|in transit)|bug bounty)\b/i, label: "Security controls published (encryption, pen tests)" },
];

const LATE_STAGE_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /\b(tens of )?millions of (users|developers|customers|people|businesses|teams|creators|merchants)\b|\b\d{2,4}(\.\d)?\s?(m|million|b|billion)\+?\s(users|developers|customers|people|businesses)\b/i, label: "Serves millions of users" },
  { re: /\bworld'?s (largest|most widely (used|adopted)|leading)\b/i, label: "Describes itself as the world's largest / most widely used" },
  { re: /\b(publicly traded|listed on (the )?(nasdaq|nyse)|\((nasdaq|nyse): ?[a-z]+\))/i, label: "Publicly traded" },
  { re: /\b(acquired by|a (microsoft|google|salesforce|oracle|amazon|adobe|ibm|cisco|atlassian) company|part of (microsoft|google|salesforce|oracle|amazon|adobe))\b/i, label: "Owned by a large corporation" },
  { re: /\b(\d{2,3}%|\d{2,3} percent) of (the )?fortune (100|500)\b|\bmost of the fortune (100|500)\b/i, label: "Used by a large share of the Fortune 500" },
];

// ── helpers ──────────────────────────────────────────────────────────────────
function lines(content: string): string[] {
  return content.split("\n").map((l) => l.replace(/^## /, "").replace(/^(Title|Description):\s*/, "").trim()).filter(Boolean);
}
function sentences(content: string): string[] {
  return lines(content)
    .flatMap((l) => l.replace(/^(Badge|Footer):\s*/, "").split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/))
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3)
    .map((s) => (s.length > 300 ? s.slice(0, 300) : s));
}
const firstMatch = (list: string[], re: RegExp) => list.find((s) => re.test(s)) ?? null;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;


/** Extract facts from one cleaned page. `shortLines` are short blocks (job titles etc.) from the cleaner. */
export function extractPageFacts(input: { content: string; pageType: PageType; shortLines?: string[] }): PageFacts {
  const facts = emptyFacts();
  const all = sentences(input.content);
  const ls = lines(input.content);
  const titleLine = input.content.match(/^Title:\s*(.+)$/m)?.[1] ?? "";
  const descLine = input.content.match(/^Description:\s*(.+)$/m)?.[1] ?? "";

  // Company name: title prefix ("Acme | Do X" / "Acme - Do X" / "Acme: Do X").
  const name = titleLine.split(/\s[|–—-]\s|:\s/)[0]?.trim();
  if (name && name.length <= 40 && words(name) <= 4) facts.company_name = name;

  // Product description: meta description, else first substantial hero sentence.
  const hero = all.slice(0, 15);
  const desc = descLine && words(descLine) >= 6 ? descLine : hero.find((s) => words(s) >= 8) ?? null;
  if (desc && ["homepage", "product", "about"].includes(input.pageType)) {
    facts.product_description = desc;
    facts.product_quote = desc;
  }

  // Software product?
  const focus = ["homepage", "product", "pricing", "about"].includes(input.pageType) ? all.slice(0, 40) : all;
  const sw = firstMatch(focus, SOFTWARE_YES);
  if (sw) {
    facts.is_software_product = "yes";
    facts.software_quote = sw;
  } else if (input.pageType === "homepage") {
    const notSw = firstMatch(all, SOFTWARE_NO);
    if (notSw) {
      facts.is_software_product = "no";
      facts.software_quote = notSw;
    }
  }

  // Business buyer?
  const b2b = firstMatch(focus, B2B_YES);
  if (b2b) {
    facts.sells_to_businesses = "yes";
    facts.buyer_quote = b2b;
  } else if (input.pageType === "homepage") {
    const b2c = firstMatch(all, B2C_NO);
    if (b2c) {
      facts.sells_to_businesses = "no";
      facts.buyer_quote = b2c;
    }
  }

  // Certifications the company itself holds (vendor marketing language excluded).
  for (const s of all) {
    if (!CERT_RE.test(s) || VENDOR_CERT_LANGUAGE.test(s)) continue;
    if (/\?\s*$/.test(s) || /^(does|do|is|are|has|have|can|will|how|what|why|which|should)\b/i.test(s)) continue; // questions are not claims
    if (/\b(working towards|in progress|underway|planned|pursuing|plan to|will (be|achieve|complete)|expect(ed|s)? to|on track|coming soon|in the process of)\b/i.test(s)) continue;
    if (SELF_CERT.test(s)) {
      const m = s.match(CERT_RE);
      if (m) facts.certifications_held.push({ name: normalizeCertName(m[0]), quote: s });
    }
  }

  // Funding stage: a named round in a funding sentence.
  for (const s of all) {
    if (!FUNDING_CONTEXT.test(s)) continue;
    const series = s.match(/\bseries ([a-h])\b/i);
    if (series) {
      const letter = series[1].toLowerCase();
      facts.funding_stage = letter === "a" ? "series_a" : letter === "b" ? "series_b" : letter === "c" ? "series_c" : "series_d_plus";
      facts.funding_quote = s;
      break;
    }
    if (/\bpre-?seed\b/i.test(s)) { facts.funding_stage = "pre_seed"; facts.funding_quote = s; break; }
    if (/\bseed (round|funding|stage|investment)\b/i.test(s)) { facts.funding_stage = "seed"; facts.funding_quote = s; break; }
  }

  // Open roles (careers pages only): short job-title lines.
  if (input.pageType === "careers") {
    const pool = [...(input.shortLines ?? []), ...ls];
    const seen = new Set<string>();
    for (const l of pool) {
      const t = l.replace(/\s+/g, " ").trim();
      const w = words(t);
      if (w < 2 || w > 9 || /[.!?]$/.test(t) || !ROLE_WORD.test(t) || NOT_A_ROLE.test(t)) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      facts.open_roles.push({ title: t, quote: t });
      if (facts.open_roles.length >= 60) break;
    }
    const stated = all.find((s) => /\b(\d{1,4})\s+(open\s+)?(roles|positions|jobs|openings|opportunities)\b/i.test(s));
    if (stated) {
      facts.stated_open_role_count = Number(stated.match(/\b(\d{1,4})\s+(open\s+)?(roles|positions|jobs|openings|opportunities)\b/i)![1]);
      facts.role_count_quote = stated;
    }
    for (const r of facts.open_roles) {
      if (SECURITY_ROLE.test(r.title)) facts.compliance_signals.push({ signal: `Hiring for security/compliance: ${r.title}`, quote: r.quote });
    }
  }

  // Enterprise and compliance-pressure signals: first sentence per rule.
  if (input.pageType === "pricing") {
    const tier = (input.shortLines ?? []).find((l) => /^(enterprise|enterprise plan|custom|scale|business plus)$/i.test(l.trim()));
    if (tier) facts.enterprise_signals.push({ signal: "Enterprise plan / tier", quote: tier });
  }
  for (const rule of ENTERPRISE_RULES) {
    const s = firstMatch([...all, ...(input.pageType === "pricing" ? input.shortLines ?? [] : [])], rule.re);
    if (s && !facts.enterprise_signals.some((e) => e.signal === rule.label)) facts.enterprise_signals.push({ signal: rule.label, quote: s });
  }
  if (["homepage", "about"].includes(input.pageType)) {
    for (const rule of LATE_STAGE_RULES) {
      const s = firstMatch(all, rule.re);
      if (s) facts.late_stage_signals.push({ signal: rule.label, quote: s });
    }
  }
  for (const rule of COMPLIANCE_RULES) {
    const s = firstMatch(all, rule.re);
    if (s) facts.compliance_signals.push({ signal: rule.label, quote: s });
  }
  return facts;
}

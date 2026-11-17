// validateEvidence() + extractCompanyFacts(): turn Claude's page facts into EvidenceItems,
// accepting a claim only if its supporting quote really appears in the cleaned page text.
// The code - not the model - decides which named fields are populated.
import type { PageFacts } from "@/lib/extract/rules";
import { CERT_RE } from "@/lib/scraper/clean";
import type { EvidenceItem, PageType, ResearchState } from "@/lib/types";

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9&%$]+/g, " ")
    .trim();
}

/** A quote is supported when every ellipsis-separated segment of it occurs verbatim (normalised) in the page. */
export function quoteIsSupported(quote: string | null | undefined, content: string): boolean {
  if (!quote) return false;
  const haystack = normalizeForMatch(content);
  const segments = quote
    .split(/\.\.\.|…/)
    .map(normalizeForMatch)
    .filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  const totalWords = segments.join(" ").split(" ").length;
  if (totalWords < 2) return false;
  return segments.every((seg) => haystack.includes(seg));
}

/** "ISO/IEC 27001" and "iso27001" are the same certification; "SOC2" is "SOC 2". */
export function normalizeCertName(raw: string): string {
  const v = raw.replace(/\s+/g, " ").trim();
  if (!v) return "";
  if (/soc/i.test(v)) return `SOC ${v.match(/[12]/)?.[0] ?? "2"}`;
  if (/iso/i.test(v)) return `ISO ${v.match(/\d{4,5}/)?.[0] ?? ""}`.trim();
  if (/pci/i.test(v)) return "PCI DSS";
  return v.toUpperCase();
}

const STAGE_LABEL: Record<string, string> = {
  pre_seed: "Pre-seed", seed: "Seed", series_a: "Series A", series_b: "Series B", series_c: "Series C",
  series_d_plus: "Series D+", public: "Public", bootstrapped: "Bootstrapped", acquired: "Acquired",
};

const STRONG_CERT_CLAIM = new RegExp(
  `(?:${CERT_RE.source})[^.\\n]{0,40}\\b(certified|compliant|attested|attestation|audited|certification|report)\\b|\\b(we are|we're|is|are|achieved|completed|maintains?|holds?)\\b[^.\\n]{0,30}(?:${CERT_RE.source})`,
  "i",
);

/** Deterministic backup for Gate 1: strong certification claims on trust/security pages or footer badges. */
export function detectCertificationClaims(content: string, pageType: PageType): Array<{ name: string; quote: string }> {
  const lines = content.split("\n");
  const out: Array<{ name: string; quote: string }> = [];
  const NOT_HELD = /\b(planned|in progress|underway|coming soon|pursuing|working towards|not started|roadmap|q[1-4] 20\d\d|expected|upcoming|pending)\b/i;
  // Trust pages often put the status a line or two below the name ("SOC 2" … "Status: Planned (2026)").
  // If ANY occurrence of a certification on the page carries a not-held status, it is not held.
  const notHeld = new Set<string>();
  lines.forEach((line, i) => {
    const m = line.match(CERT_RE);
    if (!m) return;
    const own = normalizeCertName(m[0]);
    const after = lines.slice(i + 1, i + 5);
    // Stop at the next card: a line naming a *different* certification (descriptions repeat the same name).
    const nextCert = after.findIndex((l) => CERT_RE.test(l) && normalizeCertName(l.match(CERT_RE)![0]) !== own);
    const statusLines = nextCert >= 0 ? after.slice(0, nextCert) : after;
    if (NOT_HELD.test(line) || statusLines.some((l) => NOT_HELD.test(l))) notHeld.add(own);
  });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineCert = line.match(CERT_RE);
    if (lineCert && notHeld.has(normalizeCertName(lineCert[0]))) continue;
    const isBadge = /^(Badge|Footer):/.test(line);
    if (!(pageType === "security" || isBadge)) continue;
    // Compliance vendors market certifications they help customers get: not a certification held.
    if (/\b(help(s|ing)? (you|teams|companies)|get (you )?(soc|iso|certified|compliant)|become (soc|iso|compliant)|automate|your (soc|iso|audit)|in weeks|in days)\b/i.test(line)) continue;
    // On a trust/security page, a short line that is just a certification name ("SOC 2 Type II") is a held certification.
    const bareOnTrustPage = pageType === "security" && line.split(/\s+/).length <= 8 && CERT_RE.test(line) && !/\b(in progress|underway|coming soon|pursuing|working towards|planned|roadmap|what is|guide|learn)\b/i.test(line);
    const m = line.match(STRONG_CERT_CLAIM) ?? (isBadge && /^Badge:/.test(line) ? line.match(CERT_RE) : null) ?? (bareOnTrustPage ? line.match(CERT_RE) : null);
    if (!m) continue;
    const name = normalizeCertName(line.match(CERT_RE)?.[0] ?? "");
    const quote = line.replace(/^(Badge|Footer):\s*/, "").slice(0, 200);
    if (name) out.push({ name, quote });
  }
  return out;
}

export interface ExtractionOutcome {
  accepted: EvidenceItem[];
  rejected: Array<{ field: string; value: string; quote: string | null }>;
  patch: Partial<ResearchState>;
}

/** Merge one page's facts into the research state, keeping only verified evidence. */
export function extractCompanyFacts(
  state: ResearchState,
  facts: PageFacts,
  page: { url: string; title: string; pageType: PageType; content: string },
  now: Date,
): ExtractionOutcome {
  const accepted: EvidenceItem[] = [];
  const rejected: ExtractionOutcome["rejected"] = [];
  const extractedAt = now.toISOString();

  const add = (field: string, value: string, quote: string | null | undefined, confidence: number): boolean => {
    if (!value?.trim()) return false;
    if (!quoteIsSupported(quote, page.content)) {
      rejected.push({ field, value, quote: quote ?? null });
      return false;
    }
    accepted.push({
      field,
      value: value.trim().slice(0, 500),
      sourceUrl: page.url,
      sourceTitle: page.title || page.url,
      extractedAt,
      confidence,
      supportingQuote: quote!.trim().slice(0, 400),
    });
    return true;
  };

  const patch: Partial<ResearchState> = {};

  if (facts.company_name && !state.companyName && normalizeForMatch(page.content).includes(normalizeForMatch(facts.company_name))) {
    patch.companyName = facts.company_name.trim().slice(0, 120);
  }

  if (facts.product_description && add("product_description", facts.product_description, facts.product_quote, 0.85)) {
    if (!state.companyDescription) patch.companyDescription = facts.product_description.trim().slice(0, 500);
  }

  if (facts.is_software_product !== "unknown" && add("is_saas", facts.is_software_product, facts.software_quote, 0.8)) {
    const v = facts.is_software_product === "yes";
    // Positive verified evidence wins over a negative reading from another page.
    if (state.isSaas !== true) patch.isSaas = v;
  }
  if (facts.sells_to_businesses !== "unknown" && add("is_b2b", facts.sells_to_businesses, facts.buyer_quote, 0.8)) {
    const v = facts.sells_to_businesses === "yes";
    if (state.isB2B !== true) patch.isB2B = v;
  }

  const certs = new Set(state.namedCertifications);
  for (const c of facts.certifications_held) {
    if (!CERT_RE.test(c.name)) {
      rejected.push({ field: "certification", value: c.name, quote: c.quote });
      continue; // only *named* certifications count
    }
    const certName = normalizeCertName(c.name);
    if ([...certs].includes(certName)) continue;
    if (add("certification", certName, c.quote, 0.85)) certs.add(certName);
  }
  for (const c of detectCertificationClaims(page.content, page.pageType)) {
    if (![...certs].some((n) => normalizeForMatch(n).includes(normalizeForMatch(c.name)))) {
      if (add("certification", c.name, c.quote, 0.75)) certs.add(c.name);
    }
  }
  if (certs.size !== state.namedCertifications.length) patch.namedCertifications = [...certs];

  if (facts.funding_stage !== "unknown") {
    const label = STAGE_LABEL[facts.funding_stage] ?? facts.funding_stage;
    if (add("funding_stage", label, facts.funding_quote, 0.85) && !state.fundingStage) patch.fundingStage = label;
  }

  const roles = new Set<string>();
  for (const r of facts.open_roles.slice(0, 60)) {
    if (add("open_role", r.title, r.quote, 0.8)) roles.add(r.title.trim().toLowerCase());
  }
  let roleCount = roles.size;
  if (facts.stated_open_role_count && facts.stated_open_role_count > 0 && facts.stated_open_role_count < 10_000) {
    if (add("open_role_count", String(Math.round(facts.stated_open_role_count)), facts.role_count_quote, 0.85)) {
      roleCount = Math.max(roleCount, Math.round(facts.stated_open_role_count));
    }
  }
  if (roleCount > 0) {
    patch.openRoleCount = Math.max(state.openRoleCount ?? 0, roleCount);
    const titles = facts.open_roles.map((r) => r.title);
    const relevant = titles.filter((t) => /secur|complian|grc|risk|privacy|audit|trust/i.test(t));
    patch.hiringSignals = [...new Set([...state.hiringSignals, `${roleCount} open role(s) listed on ${page.url}`, ...relevant.map((t) => `Hiring: ${t}`)])];
  }

  const ent = [...state.enterpriseSignals];
  for (const s of facts.enterprise_signals.slice(0, 10)) if (add("enterprise_signal", s.signal, s.quote, 0.75)) ent.push(s.signal);
  if (ent.length !== state.enterpriseSignals.length) patch.enterpriseSignals = [...new Set(ent)];

  for (const s of facts.late_stage_signals.slice(0, 5)) add("late_stage_signal", s.signal, s.quote, 0.75);

  const comp = [...state.complianceSignals];
  for (const s of facts.compliance_signals.slice(0, 10)) if (add("compliance_signal", s.signal, s.quote, 0.7)) comp.push(s.signal);
  if (comp.length !== state.complianceSignals.length) patch.complianceSignals = [...new Set(comp)];

  patch.evidence = [...state.evidence, ...accepted];
  patch.rejectedEvidence = state.rejectedEvidence + rejected.length;
  return { accepted, rejected, patch };
}

// find_contact: discover named decision-makers on the company's own public pages
// (team / leadership / about / homepage), then rank them by role relevance.
// Names are only ever taken from the page text. Nothing is guessed or constructed.
import type { Contact } from "@/lib/types";

const TITLE_RE =
  /\b(chief [a-z]+(?: [a-z]+)? officer|ceo|cto|cfo|coo|ciso|cio|cpo|cro|cso|co-?founder|founder|vp|vice president|svp|evp|head of [a-z&/ ]+|director(?: of [a-z&/ ]+)?|president|general counsel|managing director|partner)\b/i;
const NAME_TOKEN = /^[A-Z][a-zA-Z'’-]{1,20}\.?$/;
const STOP = new Set([
  "Our", "The", "Get", "Read", "Learn", "Book", "Contact", "About", "Meet", "Join", "Team", "Leadership", "Board", "Investors",
  "Product", "Company", "Customer", "Customers", "Security", "Sales", "Marketing", "Engineering", "Careers", "Pricing", "Home",
  "Blog", "News", "Press", "Request", "Demo", "Start", "Free", "Trial", "Sign", "Log", "Watch", "See", "View", "More", "All",
  "Head", "Chief", "Officer", "Director", "Founder", "Co-founder", "Cofounder", "President", "Vice", "VP", "CEO", "CTO", "COO", "CFO",
  "Platform", "Solutions", "Features", "Resources", "Support", "Privacy", "Terms", "Trust", "Partners", "Integrations", "Why", "How",
  "What", "New", "Our", "We", "You", "Your", "And", "With", "For", "In", "Of", "At", "By", "To", "Inc", "Ltd", "LLC", "Global", "India", "USA", "Co",
]);

export interface PersonMention { name: string; title: string; quote: string; sourceUrl: string }

export function looksLikeName(s: string): boolean {
  const tokens = s.trim().split(/\s+/);
  if (tokens.length < 2 || tokens.length > 3) return false;
  return tokens.every((t) => NAME_TOKEN.test(t) && !STOP.has(t.replace(/\.$/, "")));
}

function cleanTitle(t: string): string | null {
  const s = t
    .replace(/\s+/g, " ")
    .replace(/^[,|–—:-]\s*/, "")
    // Drop trailing social / UI labels: "Co-Founder · LinkedIn", "CEO | Twitter".
    .replace(/\s*[·|•]\s*(linkedin|twitter|x|github|email|website|read more|bio)\s*$/i, "")
    .trim();
  if (!TITLE_RE.test(s) || s.split(" ").length > 10 || /[.!?]$/.test(s)) return null;
  return s;
}

/**
 * Testimonials name people at OTHER companies ("Founder at Perplexity", "CEO, Vercel").
 * A title that points at an organisation other than this company is not an employee.
 */
export function worksElsewhere(title: string, companyKeys: string[]): boolean {
  if (/\bpreviously\b|\bformerly\b|\bex-|\bsubsidiary\b/i.test(title)) return true;
  const keys = companyKeys.map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((k) => k.length >= 3);
  const isUs = (org: string) => {
    const o = org.toLowerCase().replace(/[^a-z0-9]/g, "");
    return !!o && keys.some((k) => o.includes(k) || k.includes(o));
  };
  const GENERIC = /^(engineering|security|compliance|product|marketing|sales|operations|finance|people|growth|design|data|it|technology|platform|infrastructure|customer success|revenue|research)$/i;
  // Any web domain in the title ("CEO, 5paisa.com") names the employer.
  for (const d of title.match(/[a-z0-9-]+\.(com|io|ai|co|in|app|dev|net|org)/gi) ?? []) if (!isUs(d.split(".")[0])) return true;
  // "Title at Org", "Title @ Org", "Title, Org", "Title | Org", "Title of Org" (ignore trailing parentheticals).
  const t = title.replace(/\([^)]*\)/g, "").trim();
  const m = t.match(/(?:\bat\b|@|,|\||–|—|\bof\b)\s*([A-Z0-9][\w.&' -]{1,40})$/) ?? t.match(/\b(?:founder|ceo|cto|coo|cfo|head of [a-z]+|vp [a-z]+|director)\s+([A-Z][\w.&'-]{1,30}(?:\.[a-z]{2,})?)\b/);
  if (!m) return false;
  const org = m[1].trim();
  if (GENERIC.test(org) || /^(co-?founder|founder|ceo|cto|coo|cfo|president|board chair(man)?|chairman)$/i.test(org)) return false;
  return !isUs(org);
}

/** Find (name, title) pairs in short page lines and sentences. */
export function extractPeople(linesIn: string[], sourceUrl: string, companyKeys: string[] = []): PersonMention[] {
  const lines = linesIn.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: PersonMention[] = [];
  const push = (name: string, title: string, quote: string) => {
    if (worksElsewhere(title, companyKeys)) return;
    if (!out.some((p) => p.name === name)) out.push({ name, title, quote, sourceUrl });
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "Jane Doe" followed by "Co-founder & CTO" (or the reverse order).
    if (looksLikeName(line)) {
      const next = lines[i + 1] ? cleanTitle(lines[i + 1]) : null;
      const prev = lines[i - 1] ? cleanTitle(lines[i - 1]) : null;
      if (next) push(line, next, `${line}\n${lines[i + 1]}`);
      else if (prev && !looksLikeName(lines[i - 1])) push(line, prev, `${lines[i - 1]}\n${line}`);
      continue;
    }
    // "Jane Doe, CTO" / "Jane Doe - Head of Security" / "Jane Doe | Founder".
    const inline = line.match(/^([A-Z][\w'’.-]+(?: [A-Z][\w'’.-]+){1,2})\s*(?:,|–|—|-|\||:)\s*(.{2,70})$/);
    if (inline && looksLikeName(inline[1])) {
      const title = cleanTitle(inline[2]);
      if (title) push(inline[1], title, line);
      continue;
    }
    // "founded by Jane Doe and John Roe" / "CEO Jane Doe" in prose.
    const founded = line.match(/\bfounded (?:in \d{4} )?by ([A-Z][a-z]+ [A-Z][a-z]+)(?:,? and ([A-Z][a-z]+ [A-Z][a-z]+))?/);
    if (founded) {
      for (const n of [founded[1], founded[2]].filter(Boolean) as string[]) if (looksLikeName(n)) push(n, "Co-founder", line);
    }
    const roleName = line.match(/\b(CEO|CTO|CISO|COO|Co-?founder|Founder)(?: and Co-?founder)?,? ([A-Z][a-z]+ [A-Z][a-z]+)\b/);
    if (roleName && looksLikeName(roleName[2])) push(roleName[2], roleName[1], line);
    // Origin story: "Uku Taht started Plausible in 2018" / "Jane Doe and John Roe founded Acme".
    const keyAlt = companyKeys.map((k) => k.replace(/[^a-z0-9]/gi, "")).filter((k) => k.length >= 3).join("|");
    if (keyAlt) {
      const origin = line.match(new RegExp(`\\b([A-Z][a-z'’-]+ [A-Z][a-z'’-]+)(?: and ([A-Z][a-z'’-]+ [A-Z][a-z'’-]+))? (?:started|founded|co-?founded|launched|created|built) (?:${keyAlt})\\b`, "i"));
      if (origin) for (const n of [origin[1], origin[2]].filter(Boolean) as string[]) if (looksLikeName(n)) push(n, origin[2] ? "Co-founder" : "Founder", line);
    }
    // Press style: '…," said Jane Doe, CEO of Acme.' / 'Jane Doe, co-founder and CEO, said …'
    const NAME = "([A-Z][a-z'’-]+(?: [A-Z][a-z'’-]+){1,2})";
    const ROLE = "((?:co-?founder|founder|chief [a-z]+(?: [a-z]+)? officer|ceo|cto|coo|cfo|ciso|cio|president|head of [a-z&/ ]{2,30}|vp(?: of)? [a-z&/ ]{2,30}|vice president(?: of)? [a-z&/ ]{2,30}|director of [a-z&/ ]{2,30})(?:,? (?:and|&) (?:co-?founder|founder|ceo|cto|coo|president))?)";
    const said = line.match(new RegExp(`\\b(?:said|says|explained|explains|added|adds|according to)\\s+${NAME},\\s+${ROLE}(?:\\s+(?:at|of)\\s+([A-Z][\\w.&-]+(?: [A-Z][\\w.&-]+)?))?`, "i"));
    const saidAfter = line.match(new RegExp(`${NAME},\\s+${ROLE}(?:\\s+(?:at|of)\\s+([A-Z][\\w.&-]+(?: [A-Z][\\w.&-]+)?))?,\\s+(?:said|says|explained|added)\\b`, "i"));
    for (const m of [said, saidAfter]) {
      if (!m || !looksLikeName(m[1])) continue;
      const title = m[3] ? `${m[2]} at ${m[3]}` : m[2];
      push(m[1], title.replace(/^./, (c) => c.toUpperCase()), line);
    }
  }
  return out.slice(0, 40);
}

const ROLE_PRIORITY: Array<{ re: RegExp; label: string }> = [
  { re: /\bciso\b|chief information security|\b(head|director|vp|vice president|lead)\b.*\b(security|infosec)\b/i, label: "Security leader (CISO / Head of Security)" },
  { re: /\b(head|director|vp|vice president|lead|manager)\b.*\b(compliance|grc|risk|trust)\b|chief compliance/i, label: "Compliance leader" },
  { re: /\b(vp|vice president|head|director|svp)\b.*\bengineering\b/i, label: "Engineering leader (VP Engineering)" },
  { re: /\bcto\b|chief technology officer|chief technical officer/i, label: "CTO" },
  { re: /\b(cio|chief information officer|head of it|it director)\b/i, label: "IT leader" },
  { re: /\b(coo|chief operating officer)\b/i, label: "COO (often owns compliance at smaller companies)" },
  { re: /\b(ceo|chief executive|founder|co-?founder|cofounder)\b/i, label: "Founder / CEO (usual compliance owner before Series B)" },
];

/** Rank mentions by role relevance. Unranked titles are dropped (not a decision-maker for compliance). */
export function rankPeople(people: PersonMention[]): Contact[] {
  const ranked: Array<{ rank: number; c: Contact }> = [];
  for (const p of people) {
    const idx = ROLE_PRIORITY.findIndex((r) => r.re.test(p.title));
    if (idx < 0) continue;
    ranked.push({
      rank: idx,
      c: {
        name: p.name,
        title: p.title,
        source: "website",
        sourceUrl: p.sourceUrl,
        supportingQuote: p.quote,
        selectionReason: `${ROLE_PRIORITY[idx].label}: "${p.name}, ${p.title}" listed on ${p.sourceUrl} (priority ${idx + 1} of ${ROLE_PRIORITY.length}).`,
      },
    });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.c);
}

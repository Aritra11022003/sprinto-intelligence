// Domain input parsing, normalisation and validation.

export interface ParsedDomains {
  domains: string[];
  rejected: Array<{ input: string; reason: string }>;
}

const HOSTNAME_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".test", ".example", ".invalid", ".onion"];

/** Normalise one user-entered value (domain, URL or "www." host) to a bare lowercase hostname. */
export function normalizeDomain(raw: string): { domain: string } | { error: string } {
  let value = raw.trim().replace(/^[<"'(]+|[>"'),.;]+$/g, "");
  if (!value) return { error: "Empty value" };
  if (value.includes("@") && !value.includes("/")) return { error: "Looks like an email address, not a company domain" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: "Not a valid domain or URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Only http(s) domains are supported" };
  if (url.username || url.password) return { error: "URLs with credentials are not allowed" };
  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) {
    return { error: "IP addresses are not allowed; enter a company domain" };
  }
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { error: "Private, local or reserved hostnames are not allowed" };
  }
  if (!HOSTNAME_RE.test(host)) return { error: "Not a valid public domain (expected something like acme.com)" };
  return { domain: host };
}

// ── Extracting domains from messy pasted text ──────────────────────────────────
// Users paste numbered lists, bullets, "Company — URL" pairs, URLs with paths and query strings.
// We find the domain-like tokens inside each entry and validate each one; everything else on
// the line (numbering, company name, punctuation) is just a label and is dropped.

const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`|,;()[\]{}]+/gi;
const EMAIL_TOKEN = /[^\s@<>()[\]{}"',;|]+@[^\s@<>()[\]{}"',;|]+\.[a-z]{2,}/gi;
const IPV4_TOKEN = /(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#][^\s<>"'`|,;()[\]{}]*)?(?![\w.])/g;
const IPV6_TOKEN = /\[[0-9a-f:.]+\](?::\d+)?/gi;
const LOCALHOST_TOKEN = /(?<![\w.-])localhost(?::\d+)?(?:[/?#][^\s<>"'`|,;()[\]{}]*)?(?![\w.-])/gi;
const HOST_TOKEN = /(?<![\w@./:-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#][^\s<>"'`|,;()[\]{}]*)?(?![\w@-])/gi;

/** Remove list markers and surrounding decoration: "1.", "2)", "(3)", "#4", "-", "*", "•", "→". */
export function stripListMarker(line: string): string {
  let s = line.trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/^(?:[-*•·▪◦‣–—>→]+|\(?\d{1,3}[.):\]](?!\d)|#\d{1,3}[.):]?(?!\d)|\[\s?[x ]?\s?\])\s*/i, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/** Find every domain-like token in a piece of text. URLs win: if a line has a URL, bare words are ignored. */
export function extractDomainTokens(text: string): { tokens: string[]; emails: string[] } {
  let rest = text;
  const emails = rest.match(EMAIL_TOKEN) ?? [];
  for (const e of emails) rest = rest.replace(e, " ");
  const urls = rest.match(URL_TOKEN) ?? [];
  if (urls.length) return { tokens: urls, emails };
  const special = [...(rest.match(IPV6_TOKEN) ?? []), ...(rest.match(IPV4_TOKEN) ?? []), ...(rest.match(LOCALHOST_TOKEN) ?? [])];
  for (const t of special) rest = rest.replace(t, " ");
  const hosts = rest.match(HOST_TOKEN) ?? [];
  return { tokens: [...special, ...hosts], emails };
}

const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);
const NO_DOMAIN = "No domain or URL found (expected something like acme.com or https://acme.com)";

/**
 * Parse free-form input into validated, de-duplicated domains. Every entry that can't be used
 * is returned in `rejected` with a reason (nothing is silently discarded).
 */
export function parseDomainInput(input: string | string[], maxDomains: number): ParsedDomains {
  const r = parseResearchInput(input, maxDomains, { contacts: false });
  return { domains: r.entries.map((e) => e.domain), rejected: r.rejected };
}

/** True when `host` is the company domain itself or one of its subdomains. */
export function isSameSite(host: string, siteDomain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = siteDomain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

export interface ResearchEntry {
  domain: string;
  manualContact: { name: string; title: string } | null;
  /** The original pasted entry this domain was extracted from (for the preview). */
  source?: string;
}

const NAME_OK = /^[\p{L}][\p{L}' .-]{1,80}$/u;
const looksLikePersonName = (s: string) => NAME_OK.test(s) && s.trim().split(/\s+/).length >= 2 && s.trim().split(/\s+/).length <= 4 && /^\p{Lu}/u.test(s.trim());

/**
 * Parse the research input. One entry per line; each line may be:
 *   acme.com · https://www.acme.com/pricing?x=1 · 1. Acme — https://acme.com · • Acme (acme.com)
 *   acme.com | Priya Raman | CTO        (optional known contact, "Option B" in the brief)
 *   acme.com, Priya Raman, CTO
 *   a.com, b.io c.dev                   (several domains on one line)
 */
export function parseResearchInput(
  input: string | string[],
  maxDomains: number,
  opts: { contacts?: boolean } = {},
): { entries: ResearchEntry[]; rejected: ParsedDomains["rejected"] } {
  const allowContacts = opts.contacts !== false;
  const rawLines = (Array.isArray(input) ? input : [input]).flatMap((c) => String(c ?? "").split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const entries: ResearchEntry[] = [];
  const rejected: ParsedDomains["rejected"] = [];

  const add = (token: string, source: string, manualContact: ResearchEntry["manualContact"], label: string) => {
    const n = normalizeDomain(token);
    if ("error" in n) {
      rejected.push({ input: clip(label), reason: n.error });
      return;
    }
    if (entries.some((e) => e.domain === n.domain)) {
      rejected.push({ input: clip(label), reason: `Duplicate of ${n.domain}` });
      return;
    }
    if (entries.length >= maxDomains) {
      rejected.push({ input: clip(label), reason: `Exceeds the limit of ${maxDomains} domains per job` });
      return;
    }
    entries.push({ domain: n.domain, manualContact, source: clip(source) });
  };

  for (const rawLine of rawLines) {
    const line = stripListMarker(rawLine);
    if (!line) continue;

    // Optional contact: "<entry> | Name | Title" (or tab-separated) …
    if (allowContacts && /[|\t]/.test(line)) {
      const parts = line.split(/[|\t]/).map((p) => p.trim());
      const head = extractDomainTokens(parts[0]);
      if (head.tokens.length === 1 && parts.slice(1).some(Boolean)) {
        const name = (parts[1] ?? "").replace(/\s+/g, " ").trim();
        const title = (parts[2] ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
        if (!looksLikePersonName(name)) {
          rejected.push({ input: clip(rawLine), reason: "Contact name must be a full name, e.g. acme.com | Priya Raman | CTO" });
          continue;
        }
        add(head.tokens[0], rawLine, { name, title }, rawLine);
        continue;
      }
    }
    // … or "<entry>, Name, Title", but only when the second part really looks like a person.
    if (allowContacts && line.includes(",")) {
      const parts = line.split(",").map((p) => p.trim());
      const head = extractDomainTokens(parts[0]);
      const restHasDomains = parts.slice(1).some((p) => extractDomainTokens(p).tokens.length > 0);
      if (head.tokens.length === 1 && !restHasDomains && parts.length >= 2 && looksLikePersonName(parts[1])) {
        add(head.tokens[0], rawLine, { name: parts[1].replace(/\s+/g, " "), title: (parts[2] ?? "").trim().slice(0, 100) }, rawLine);
        continue;
      }
    }

    // Semicolons always separate entries. Commas separate entries only when two or more comma parts
    // contain domains ("a.com, b.io"); otherwise the comma is part of one entry ("Zoho, https://zoho.com").
    for (const segment of line.split(";").map((x) => x.trim()).filter(Boolean)) {
      const commaParts = segment.split(",").map((x) => x.trim()).filter(Boolean);
      const withDomains = commaParts.filter((x) => extractDomainTokens(x).tokens.length > 0).length;
      const units = commaParts.length > 1 && withDomains >= 2 ? commaParts : [segment];
      for (const unit of units) {
        const { tokens, emails } = extractDomainTokens(unit);
        for (const e of emails) rejected.push({ input: clip(e), reason: "Looks like an email address, not a company domain" });
        if (tokens.length === 0) {
          if (emails.length === 0) rejected.push({ input: clip(units.length === 1 && line.split(";").length === 1 ? rawLine : unit), reason: NO_DOMAIN });
          continue;
        }
        for (const t of tokens) add(t, rawLine, null, tokens.length === 1 && units.length === 1 ? rawLine : t);
      }
    }
  }
  return { entries, rejected };
}

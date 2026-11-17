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

/** Split free-form input (newlines, commas, spaces, semicolons) into validated, de-duplicated domains. */
export function parseDomainInput(input: string | string[], maxDomains: number): ParsedDomains {
  const parts = (Array.isArray(input) ? input : [input])
    .flatMap((chunk) => String(chunk ?? "").split(/[\r\n,;\t]+/))
    .map((p) => p.trim())
    .filter(Boolean)
    // "a.com b.com" on one line -> two domains; "not a domain" stays one (rejected) entry.
    .flatMap((line) => {
      const tokens = line.split(/\s+/);
      return tokens.length > 1 && tokens.every((t) => t.includes(".")) ? tokens : [line];
    });

  const domains: string[] = [];
  const rejected: ParsedDomains["rejected"] = [];
  for (const part of parts) {
    const result = normalizeDomain(part);
    if ("error" in result) {
      rejected.push({ input: part.slice(0, 200), reason: result.error });
      continue;
    }
    if (domains.includes(result.domain)) {
      rejected.push({ input: part.slice(0, 200), reason: `Duplicate of ${result.domain}` });
      continue;
    }
    if (domains.length >= maxDomains) {
      rejected.push({ input: part.slice(0, 200), reason: `Exceeds the limit of ${maxDomains} domains per job` });
      continue;
    }
    domains.push(result.domain);
  }
  return { domains, rejected };
}

/** True when `host` is the company domain itself or one of its subdomains. */
export function isSameSite(host: string, siteDomain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = siteDomain.toLowerCase().replace(/^www\./, "");
  return h === d || h.endsWith(`.${d}`);
}

export interface ResearchEntry { domain: string; manualContact: { name: string; title: string } | null }

const NAME_OK = /^[\p{L}][\p{L}' .-]{1,80}$/u;

/**
 * Parse the research input. Each line is a domain, optionally followed by a known contact
 * (the brief's "Option B: hardcode the PoC"):
 *   acme.com
 *   acme.com | Priya Raman | CTO
 *   acme.com, Priya Raman, CTO
 * Plain comma/space-separated lists of domains also work.
 */
export function parseResearchInput(input: string | string[], maxDomains: number): { entries: ResearchEntry[]; rejected: ParsedDomains["rejected"] } {
  const rawLines = (Array.isArray(input) ? input : [input]).flatMap((c) => String(c ?? "").split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const entries: ResearchEntry[] = [];
  const rejected: ParsedDomains["rejected"] = [];
  const pushDomains = (text: string) => {
    const r = parseDomainInput(text, maxDomains);
    for (const d of r.domains) {
      if (entries.some((e) => e.domain === d)) rejected.push({ input: d, reason: `Duplicate of ${d}` });
      else if (entries.length >= maxDomains) rejected.push({ input: d, reason: `Exceeds the limit of ${maxDomains} domains per job` });
      else entries.push({ domain: d, manualContact: null });
    }
    rejected.push(...r.rejected);
  };
  for (const line of rawLines) {
    const parts = line.includes("|") || line.includes("\t") ? line.split(/[|\t]/).map((p) => p.trim()) : line.split(",").map((p) => p.trim());
    const firstIsDomain = "domain" in normalizeDomain(parts[0] ?? "");
    const restAreDomains = parts.slice(1).every((p) => !p || "domain" in normalizeDomain(p));
    if (parts.length >= 2 && firstIsDomain && !restAreDomains) {
      const n = normalizeDomain(parts[0]) as { domain: string };
      const name = (parts[1] ?? "").replace(/\s+/g, " ").trim();
      const title = (parts[2] ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
      if (!NAME_OK.test(name) || name.split(" ").length < 2) {
        rejected.push({ input: line.slice(0, 200), reason: "Contact name must be a full name, e.g. acme.com | Priya Raman | CTO" });
        continue;
      }
      if (entries.some((e) => e.domain === n.domain)) {
        rejected.push({ input: line.slice(0, 200), reason: `Duplicate of ${n.domain}` });
        continue;
      }
      if (entries.length >= maxDomains) {
        rejected.push({ input: line.slice(0, 200), reason: `Exceeds the limit of ${maxDomains} domains per job` });
        continue;
      }
      entries.push({ domain: n.domain, manualContact: { name, title } });
    } else {
      pushDomains(line);
    }
  }
  return { entries, rejected };
}

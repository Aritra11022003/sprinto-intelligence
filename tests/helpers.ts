// Test harness: a fake website and a recording mailer. No network, no external APIs.
import type { AgentDeps } from "@/lib/agent/graph";
import type { Mailer } from "@/lib/email/gmail";
import type { FetchDeps } from "@/lib/scraper/fetch";
import { initialState, type ResearchState } from "@/lib/types";

export type PageSpec = string | { status: number; body?: string; headers?: Record<string, string> } | ((attempt: number) => { status: number; body?: string; headers?: Record<string, string> });

/** A fake website. Keys are paths ("/", "/careers", "/robots.txt"). Unknown paths 404. */
export function fakeSite(domain: string, pages: Record<string, PageSpec>) {
  const requests: string[] = [];
  const attempts = new Map<string, number>();
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.toString());
    const n = (attempts.get(url.pathname) ?? 0) + 1;
    attempts.set(url.pathname, n);
    if (!url.hostname.endsWith(domain)) return new Response("not found", { status: 404 });
    const spec = pages[url.pathname] ?? pages[url.pathname.replace(/\/$/, "")];
    if (spec === undefined) return new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } });
    const resolved = typeof spec === "string" ? { status: 200, body: spec } : typeof spec === "function" ? spec(n) : spec;
    const type = url.pathname.endsWith(".xml") ? "application/xml" : url.pathname.endsWith(".txt") ? "text/plain" : "text/html; charset=utf-8";
    return new Response(resolved.body ?? "", { status: resolved.status, headers: { "content-type": type, ...(resolved.headers ?? {}) } });
  }) as typeof fetch;
  /** Page requests only (robots.txt and sitemaps are metadata, not page hits). */
  const pageRequests = () => requests.filter((r) => !/\/robots\.txt$|\.xml$/.test(r));
  return { fetchImpl, requests, pageRequests, attempts };
}

export function fetchDepsFor(fetchImpl: typeof fetch): FetchDeps {
  return { fetchImpl, resolve: async () => ["93.184.216.34"], sleep: async () => undefined, timeoutMs: 2000, maxBytes: 2_000_000, maxRetries: 3 };
}

export const SELF = "me@example.com";

export function recordingMailer(opts: { fail?: boolean } = {}): Mailer & { sent: Array<{ to: string; subject: string; body: string }> } {
  const m = {
    provider: "gmail" as const,
    from: SELF,
    sent: [] as Array<{ to: string; subject: string; body: string }>,
    async send(msg: { to: string; subject: string; body: string }) {
      if (opts.fail) throw new Error("SMTP 535 authentication failed");
      m.sent.push(msg);
      return { id: `<msg-${m.sent.length}@gmail>` };
    },
  };
  return m;
}

let counter = 0;
export function setup(opts: { domain: string; pages: Record<string, PageSpec>; mailer?: Mailer | null; manualContact?: { name: string; title: string } }) {
  process.env.GMAIL_USER_EMAIL = SELF;
  const site = fakeSite(opts.domain, opts.pages);
  const deps: AgentDeps = {
    fetchDeps: fetchDepsFor(site.fetchImpl),
    mailer: opts.mailer === undefined ? null : opts.mailer,
    selfEmail: SELF,
    autoSend: true,
    now: () => new Date("2026-11-17T10:00:00Z"),
  };
  const state: ResearchState = initialState({ id: `c${++counter}`, domain: opts.domain, manualContact: opts.manualContact ?? null });
  return { site, deps, state };
}

// ── HTML fixtures ───────────────────────────────────────────────────────────
export const page = (title: string, main: string, footer = "", nav = true) => `<!doctype html><html><head><title>${title}</title></head><body>
${nav ? `<nav><a href="/">Home</a><a href="/product">Product</a><a href="/pricing">Pricing</a><a href="/careers">Careers</a><a href="/security">Security</a><a href="/team">Team</a></nav>` : ""}
<main>${main}</main>
<footer><p>© 2026 Company Inc. All rights reserved.</p>${footer}</footer>
<div class="cookie-banner">We use cookies to improve your experience. Accept all cookies.</div>
</body></html>`;

export const HOME_B2B = page(
  "Flowlane | Workflow automation for finance teams",
  `<h1>Workflow automation software for finance teams</h1>
   <p>Flowlane is a cloud platform that helps finance teams at mid-market companies automate approvals and close the books faster.</p>
   <p>Over 400 businesses use Flowlane to run procurement and expense workflows across their organisation.</p>`,
);
export const PRICING_ENTERPRISE = page(
  "Pricing | Flowlane",
  `<h1>Pricing</h1><h2>Starter</h2><p>For small teams getting started with automated approvals at 29 dollars per user per month.</p>
   <h2>Enterprise</h2><p>Enterprise plan with SSO, SAML, audit logs, a dedicated success manager and custom pricing for large organisations.</p>`,
);
export const TEAM_PAGE = page(
  "Team | Flowlane",
  `<h1>Meet the team behind Flowlane and our mission to fix finance operations</h1>
   <div class="person"><span>Priya Raman</span><span>Co-founder &amp; CTO</span></div>
   <div class="person"><span>Sam Lee</span><span>Head of Marketing</span></div>
   <div class="person"><span>Ana Ortiz</span><span>CEO</span></div>
   <blockquote>Flowlane changed how we close the books. <cite>Mark Fields, CFO at Globex</cite></blockquote>`,
);
export const NO_SIGNAL_PAGE = (title: string) => page(title, `<h1>${title}</h1><p>We believe in building great things together with our wonderful community of people every single day.</p>`);

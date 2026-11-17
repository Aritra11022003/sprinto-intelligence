// Exception / edge-case tests against a running deployment's API.
// Usage: npx tsx scripts/test-exceptions.ts https://sprinto-intelligence.vercel.app
// Every case must return the expected HTTP status and a JSON error message. Nothing may crash (5xx).

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

interface Case { name: string; path: string; method?: string; body?: string; headers?: Record<string, string>; expect: number | number[]; check?: (json: any, text: string) => string | null }

const json = (v: unknown) => JSON.stringify(v);
const research = (domains: unknown) => json({ domains });

const cases: Case[] = [
  // ── /api/research: malformed requests ──
  { name: "empty body", path: "/api/research", body: "", expect: 400 },
  { name: "invalid JSON", path: "/api/research", body: "{not json", expect: 400, check: (j) => (/valid JSON/.test(j.error) ? null : "message should mention JSON") },
  { name: "missing domains field", path: "/api/research", body: json({ urls: ["a.com"] }), expect: 400 },
  { name: "domains is a number", path: "/api/research", body: json({ domains: 42 }), expect: 400 },
  { name: "domains is null", path: "/api/research", body: json({ domains: null }), expect: 400 },
  { name: "empty string", path: "/api/research", body: research(""), expect: 400, check: (j) => (/at least one/i.test(j.error) ? null : "should ask for a domain") },
  { name: "whitespace only", path: "/api/research", body: research("   \n\t  \n"), expect: 400 },
  { name: "empty array", path: "/api/research", body: research([]), expect: 400 },
  { name: "array of non-strings", path: "/api/research", body: research([1, 2, 3]), expect: 400 },
  { name: "oversized body (>100KB)", path: "/api/research", body: research("a.com\n".repeat(30_000)), expect: [400, 413] },
  { name: "wrong method GET", path: "/api/research", method: "GET", expect: 405 },

  // ── /api/research: every entry invalid → 400 with per-entry reasons ──
  { name: "plain garbage", path: "/api/research", body: research("hello world\n!!!\n???"), expect: 400, check: (j) => (j.details?.rejected?.length >= 1 ? null : "should list rejected entries") },
  { name: "email address instead of domain", path: "/api/research", body: research("ceo@acme.com"), expect: 400, check: (j) => (/email/i.test(JSON.stringify(j.details)) ? null : "reason should mention email") },
  { name: "IPv4 address", path: "/api/research", body: research("192.168.1.1"), expect: 400 },
  { name: "public IP address", path: "/api/research", body: research("8.8.8.8"), expect: 400 },
  { name: "IPv6 address", path: "/api/research", body: research("[::1]"), expect: 400 },
  { name: "localhost", path: "/api/research", body: research("localhost"), expect: 400 },
  { name: "localhost with port", path: "/api/research", body: research("http://localhost:3000"), expect: 400 },
  { name: "cloud metadata host", path: "/api/research", body: research("metadata.google.internal"), expect: 400 },
  { name: ".local / .internal names", path: "/api/research", body: research("printer.local\nvault.internal"), expect: 400 },
  { name: "javascript: URL", path: "/api/research", body: research("javascript:alert(1)"), expect: 400 },
  { name: "ftp:// URL", path: "/api/research", body: research("ftp://files.acme.com"), expect: 400 },
  { name: "URL with credentials", path: "/api/research", body: research("https://user:pass@acme.com"), expect: 400 },
  { name: "single-label name", path: "/api/research", body: research("intranet"), expect: 400 },
  { name: "script tag", path: "/api/research", body: research("<script>alert(1)</script>"), expect: 400 },
  { name: "SQL-ish input", path: "/api/research", body: research("'; DROP TABLE companies; --"), expect: 400 },
  { name: "bad manual contact name", path: "/api/research", body: research("acme.com | x | CTO"), expect: 400, check: (j) => (/full name/.test(JSON.stringify(j.details)) ? null : "should explain the name format") },

  // ── /api/email/send-to-self ──
  { name: "send: invalid JSON", path: "/api/email/send-to-self", body: "nope", expect: 400 },
  { name: "send: missing fields", path: "/api/email/send-to-self", body: json({ subject: "hi" }), expect: 400 },
  { name: "send: to a prospect address", path: "/api/email/send-to-self", body: json({ subject: "Test subject", body: "This should never be delivered to anyone else.", researchId: "t1", to: "prospect@company.com" }), expect: 403, check: (j) => (/own inbox/i.test(j.error) ? null : "should refuse other recipients") },
  { name: "send: body too long", path: "/api/email/send-to-self", body: json({ subject: "x", body: "y".repeat(20_000), researchId: "t" }), expect: 400 },

  // ── other routes ──
  { name: "health", path: "/api/health", method: "GET", expect: 200, check: (j) => (j.ok === true ? null : "ok should be true") },
  { name: "unknown history run page", path: "/history/does-not-exist", method: "GET", expect: 200 },
  { name: "unknown page → 404", path: "/this-page-does-not-exist", method: "GET", expect: 404 },
];

async function main() {
  let pass = 0;
  const failures: string[] = [];
  console.log(`Exception tests against ${BASE}\n`);
  for (const c of cases) {
    const t0 = Date.now();
    let status = 0;
    let text = "";
    let parsed: any = null;
    try {
      const res = await fetch(BASE + c.path, { method: c.method ?? "POST", headers: { "Content-Type": "application/json", ...(c.headers ?? {}) }, body: c.method === "GET" ? undefined : c.body });
      status = res.status;
      text = await res.text();
      try { parsed = JSON.parse(text); } catch { /* HTML or NDJSON */ }
    } catch (err) {
      text = String(err);
    }
    const expected = Array.isArray(c.expect) ? c.expect : [c.expect];
    let problem = expected.includes(status) ? null : `expected ${expected.join("/")} got ${status}`;
    if (!problem && status >= 400 && status < 500 && c.path.startsWith("/api") && !parsed?.error && status !== 405) problem = "4xx without a JSON error message";
    if (!problem && c.check && parsed) problem = c.check(parsed, text);
    if (status >= 500 && !expected.includes(status)) problem = `server error ${status}: ${text.slice(0, 120)}`;
    const ms = Date.now() - t0;
    if (problem) failures.push(`${c.name}: ${problem}`);
    else pass++;
    console.log(`${problem ? "✗" : "✓"} ${c.name.padEnd(34)} ${String(status).padEnd(4)} ${ms}ms${parsed?.error ? `  "${String(parsed.error).slice(0, 70)}"` : ""}${problem ? `  ← ${problem}` : ""}`);
  }
  console.log(`\n${pass}/${cases.length} passed`);
  if (failures.length) {
    console.log("\nFailures:\n- " + failures.join("\n- "));
    process.exit(1);
  }
}
main();

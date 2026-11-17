// End-to-end correctness test against a running deployment.
// Usage: npx tsx scripts/test-run.ts <base-url> "domain1\ndomain2 | Name | Title ..."
// Streams a real research run, then audits every result against the system's rules.

import type { ResearchState } from "../src/lib/types";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const INPUT = (process.argv[3] ?? "infisical.com\nlinear.app").replace(/\\n/g, "\n");
const TIME_BUDGET_MS = 120_000; // the brief's "under 2 minutes per company"

function audit(s: ResearchState, emailConfigured: boolean): string[] {
  const p: string[] = [];
  // Run state
  if (s.status !== "completed" && s.status !== "escalated") p.push(`finished in status "${s.status}"`);
  if (s.qualification === "pending") p.push("qualification never decided");
  // Five-hit rule
  if (s.hitCount > 5) p.push(`hitCount ${s.hitCount} > 5`);
  if (s.pages.length !== s.hitCount) p.push(`pages ${s.pages.length} != hitCount ${s.hitCount}`);
  if (s.pages.length && s.pages[0].pageType !== "homepage") p.push("hit 1 is not the homepage");
  if (new Set(s.pages.map((x) => x.url)).size !== s.pages.length) p.push("a URL was fetched twice");
  s.pages.forEach((pg, i) => { if (pg.hitNumber !== i + 1) p.push(`page ${pg.url} has hitNumber ${pg.hitNumber}, expected ${i + 1}`); });
  for (const pg of s.pages.slice(1)) if (!pg.selectionReason) p.push(`no reason recorded for ${pg.url}`);
  // Evidence
  const visited = new Set(s.pages.map((x) => x.url));
  for (const e of s.evidence) {
    if (!e.supportingQuote?.trim()) p.push(`evidence "${e.field}" has no quote`);
    if (!visited.has(e.sourceUrl)) p.push(`evidence source ${e.sourceUrl} was never fetched`);
  }
  // Gates
  for (const r of s.qualificationReasons) {
    if (r.result === "pass" && r.gate !== "certification" && r.evidence.length === 0) p.push(`gate ${r.gate} passed without evidence`);
    if (r.gate === "certification" && r.result === "pass" && !/does not prove/.test(r.explanation)) p.push("certification 'pass' not worded as uncertainty");
  }
  if (s.qualification === "disqualified" && s.certificationStatus === "certified" && !s.evidence.some((e) => e.field === "certification")) p.push("certified without certification evidence");
  if (s.qualification === "qualified") {
    const g = (k: string) => s.qualificationReasons.find((r) => r.gate === k)?.result;
    if (g("b2b_saas") !== "pass" || g("stage") !== "pass") p.push("QUALIFIED but a gate didn't pass");
  }
  // Outreach
  const outreach = s.qualification === "qualified" || (s.qualification === "manual_review" && !!s.emailBody);
  if (s.qualification === "qualified") {
    if (s.painPoints.length !== 2) p.push(`${s.painPoints.length} pain points (expected 2)`);
    if (!s.emailBody || !s.emailSubject) p.push("qualified but no email drafted");
  }
  if ((s.qualification === "disqualified" || s.qualification === "incomplete") && s.emailBody) p.push("email drafted for a non-qualifying company");
  if (outreach && s.emailBody) {
    const first = s.contact?.name.split(/\s+/)[0];
    const greeting = s.emailBody.split("\n")[0];
    if (first ? !greeting.includes(first) : !/team,$/.test(greeting)) p.push(`greeting "${greeting}" doesn't match contact`);
    if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(s.emailBody)) p.push("email body contains an email address");
    if (/hope this (email )?finds you well/i.test(s.emailBody)) p.push("filler phrase in email");
    const words = s.emailBody.split(/\s+/).length;
    if (words < 50 || words > 200) p.push(`email length ${words} words`);
    for (const pp of s.painPoints) if (pp.label !== "hypothesis" || !pp.evidence) p.push("pain point missing evidence or hypothesis label");
    if (emailConfigured && !s.emailError && s.emailStatus !== "sent") p.push(`email not sent (status ${s.emailStatus})`);
    if (s.emailStatus === "failed") p.push(`email send failed: ${s.emailError}`);
  }
  if (s.contact && s.contact.source === "website" && !s.contact.supportingQuote) p.push("website contact without a source quote");
  // Timing
  const ms = s.startedAt && s.completedAt ? new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime() : null;
  if (ms !== null && ms > TIME_BUDGET_MS) p.push(`took ${ms}ms (> 2 min)`);
  return p;
}

async function checkLinks(urls: string[]): Promise<string[]> {
  const bad: string[] = [];
  await Promise.all(urls.map(async (u) => {
    try {
      const r = await fetch(u, { method: "GET", redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; SprintoResearchBot/1.0; link check)" }, signal: AbortSignal.timeout(15_000) });
      if (r.status >= 400) bad.push(`${u} → HTTP ${r.status}`);
    } catch (err) {
      bad.push(`${u} → ${(err as Error).message}`);
    }
  }));
  return bad;
}

async function main() {
  console.log(`Run test against ${BASE}\nInput:\n  ${INPUT.split("\n").join("\n  ")}\n`);
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/research`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains: INPUT }) });
  if (!res.ok || !res.body) {
    console.log(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let updates = 0;
  let firstUpdateMs: number | null = null;
  let start: any = null;
  let results: ResearchState[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === "start") start = ev;
      if (ev.type === "update") { updates++; firstUpdateMs ??= Date.now() - t0; }
      if (ev.type === "done") results = ev.results;
      if (ev.type === "error") console.log("STREAM ERROR:", ev.error);
    }
  }
  const total = Date.now() - t0;
  const emailConfigured = !!start?.config?.email;
  console.log(`Stream: ${updates} live updates, first after ${firstUpdateMs}ms, done after ${total}ms. Email configured: ${emailConfigured} (${start?.config?.provider ?? "none"})`);
  if (start?.rejected?.length) console.log("Rejected inputs:", start.rejected.map((r: any) => `${r.input} (${r.reason})`).join("; "));
  console.log("");

  let failures = 0;
  const allLinks = new Set<string>();
  for (const s of results) {
    const ms = s.startedAt && s.completedAt ? new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime() : 0;
    const problems = audit(s, emailConfigured);
    s.evidence.forEach((e) => allLinks.add(e.sourceUrl));
    if (problems.length) failures++;
    console.log(`${problems.length ? "✗" : "✓"} ${s.domain.padEnd(22)} ${s.qualification.toUpperCase().padEnd(14)} ${s.hitCount}/5 pages  ${String(ms).padStart(5)}ms  contact: ${s.contact ? `${s.contact.name} (${s.contact.title ?? "?"})` : "—"}  email: ${s.emailStatus}`);
    console.log(`    stop: ${s.stopReason ?? "—"}`);
    for (const pr of problems) console.log(`    ✗ ${pr}`);
  }
  const brokenLinks = await checkLinks([...allLinks]);
  console.log(`\nSource links checked: ${allLinks.size}, broken: ${brokenLinks.length}`);
  for (const b of brokenLinks) console.log(`  ✗ ${b}`);
  console.log(`\n${results.length - failures}/${results.length} companies passed all checks. Total wall time ${(total / 1000).toFixed(1)}s.`);
  if (failures || brokenLinks.length || results.length === 0) process.exit(1);
}
main();

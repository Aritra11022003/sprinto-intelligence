// Run the full agent from the command line (no email sent): npx tsx scripts/run.ts linear.app "acme.com | Jane Doe | CTO"
import { runBatch } from "../src/lib/research";
import { defaultFetchDeps } from "../src/lib/scraper/fetch";
import { parseResearchInput } from "../src/lib/security/domain";

const { entries, rejected } = parseResearchInput(process.argv.slice(2).join("\n"), 10);
if (rejected.length) console.log("rejected:", rejected);
const t0 = Date.now();
const results = await runBatch(entries, { fetchDeps: defaultFetchDeps, mailer: null, selfEmail: null, autoSend: false, now: () => new Date() }, () => undefined);
for (const s of results) {
  console.log(`\n================ ${s.domain} → ${s.qualification.toUpperCase()} (${s.status}) hits ${s.hitCount}/5, ${new Date(s.completedAt!).getTime() - new Date(s.startedAt!).getTime()}ms`);
  console.log("name:", s.companyName, "| saas:", s.isSaas, "| b2b:", s.isB2B, "| cert:", s.certificationStatus, s.namedCertifications, "| stage:", s.fundingStage, "| roles:", s.openRoleCount);
  for (const p of s.pages) console.log(`  hit ${p.hitNumber} ${p.pageType.padEnd(9)} ${p.fetchStatus.padEnd(10)} ${p.url}  — ${p.selectionReason.slice(0, 110)}`);
  console.log("stop:", s.stopReason);
  for (const r of s.qualificationReasons) console.log(`  [${r.gate}] ${r.result}: ${r.explanation.slice(0, 150)}`);
  for (const e of s.evidence.slice(0, 14)) console.log(`   · ${e.field}: ${e.value.slice(0, 60)}  «${e.supportingQuote.slice(0, 90)}»`);
  console.log("contact:", s.contact ? `${s.contact.name} — ${s.contact.title} (${s.contact.source})` : s.contactStatus, "| candidates:", s.contactCandidates.map((c) => `${c.name}/${c.title}`).slice(0, 5).join("; "));
  for (const p of s.painPoints) console.log("  PAIN:", p.problem);
  if (s.emailBody) console.log(`  SUBJECT: ${s.emailSubject}\n${s.emailBody.replace(/^/gm, "    ")}\n  emailError: ${s.emailError}`);
  if (s.errors.length) console.log("errors:", s.errors);
}
console.log(`\nTotal ${Date.now() - t0}ms for ${results.length} companies`);

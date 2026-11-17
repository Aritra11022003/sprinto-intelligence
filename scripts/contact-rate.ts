// Measure how often drafted emails get a real named contact: npx tsx scripts/contact-rate.ts a.com b.io ...
import { runBatch } from "../src/lib/research";
import { defaultFetchDeps } from "../src/lib/scraper/fetch";
import { parseResearchInput } from "../src/lib/security/domain";
const domains = process.argv.slice(2).join("\n");
const { entries } = parseResearchInput(domains, 10);
const res = await runBatch(entries, { fetchDeps: defaultFetchDeps, mailer: null, selfEmail: null, autoSend: false, now: () => new Date() }, () => undefined);
let named = 0, outreach = 0;
for (const s of res) {
  const o = !!s.emailBody; if (o) { outreach++; if (s.contact) named++; }
  console.log(`${s.domain.padEnd(18)} ${s.qualification.padEnd(14)} ${o ? (s.contact ? `NAMED ${s.contact.name} (${s.contact.title})` : "TEAM (no name)") : "-"}  pages: ${s.pages.map((p) => p.pageType).join(",")}`);
}
console.log(`\nNamed contact on ${named}/${outreach} drafted emails`);

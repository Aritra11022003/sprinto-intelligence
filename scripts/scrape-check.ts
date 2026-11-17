// Live scraper check (no API keys needed): node --import tsx scripts/scrape-check.ts linear.app vanta.com
import { extractMainContent } from "../src/lib/scraper/clean";
import { fetchPage, fetchRobotsTxt } from "../src/lib/scraper/fetch";
import { discoverLinks, guessedCandidates } from "../src/lib/scraper/links";
import { parseRobots } from "../src/lib/scraper/robots";

for (const domain of process.argv.slice(2)) {
  const t0 = Date.now();
  const robots = parseRobots(await fetchRobotsTxt(`https://${domain}`));
  const r = await fetchPage(`https://${domain}/`, { siteDomain: domain, allowCrossSiteRedirect: true });
  console.log(`\n=== ${domain}: ${r.status} HTTP ${r.httpStatus} final=${r.finalUrl} attempts=${r.attempts} robotsAllowsHome=${robots.isAllowed("/")} (${Date.now() - t0}ms)`);
  if (r.status !== "ok" || !r.html) continue;
  const c = extractMainContent(r.html, 6000);
  console.log(`title="${c.title}" words=${c.wordCount} chars=${c.text.length} jsShell=${c.looksJsRendered} footerSignals=${JSON.stringify(c.footerSignals)}`);
  console.log(c.text.slice(0, 900).replace(/\n/g, "\n  | "));
  const links = discoverLinks(r.html, r.finalUrl, new URL(r.finalUrl).hostname.replace(/^www\./, ""));
  console.log("candidates:", links.slice(0, 12).map((l) => `${l.pageType}:${new URL(l.url).pathname}`).join("  "));
  console.log("guessed:", guessedCandidates(new URL(r.finalUrl).origin, links).map((l) => new URL(l.url).pathname).join(" "));
}

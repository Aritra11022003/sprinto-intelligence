// Integration tests for the adaptive research agent (spec section 18), on fake websites.
import { describe, expect, it } from "vitest";
import { runCompanyResearch } from "@/lib/agent/graph";
import { HitBudgetError, reserveHit } from "@/lib/agent/hit-budget";
import { MAX_HITS } from "@/lib/types";
import { HOME_B2B, NO_SIGNAL_PAGE, PRICING_ENTERPRISE, SELF, TEAM_PAGE, page, recordingMailer, setup } from "./helpers";

const DOMAIN = "flowlane.io";
const QUALIFIED_SITE = { "/": HOME_B2B, "/pricing": PRICING_ENTERPRISE, "/team": TEAM_PAGE };

describe("five-hit rule", () => {
  it("never fetches more than five unique pages and the homepage is always hit 1", async () => {
    const thin = page("Thin Co", `<h1>Thin Co</h1><p>Thin Co is a cloud platform that helps sales teams at growing companies manage their pipeline.</p>`);
    const pages = {
      "/": thin, "/security": NO_SIGNAL_PAGE("Security"), "/careers": NO_SIGNAL_PAGE("Careers"), "/pricing": NO_SIGNAL_PAGE("Pricing"),
      "/customers": NO_SIGNAL_PAGE("Customers"), "/about": NO_SIGNAL_PAGE("About"), "/product": NO_SIGNAL_PAGE("Product"), "/team": NO_SIGNAL_PAGE("Team"),
    };
    const { site, deps, state } = setup({ domain: "thinco.io", pages });
    const out = await runCompanyResearch(state, deps);
    expect(site.pageRequests().length).toBeLessThanOrEqual(MAX_HITS);
    expect(out.hitCount).toBeLessThanOrEqual(MAX_HITS);
    expect(out.pages.length).toBe(out.hitCount);
    expect(out.pages[0].pageType).toBe("homepage");
    expect(out.pages[0].hitNumber).toBe(1);
    expect(site.pageRequests()[0]).toBe("https://thinco.io/");
    expect(new Set(out.visitedUrls).size).toBe(out.visitedUrls.length);
    for (const p of out.pages.slice(1)) expect(p.selectionReason).toMatch(/Chose the \w+ page/);
  });

  it("reserveHit refuses a sixth unique page, duplicates, and a non-homepage first hit", () => {
    const visited = ["https://a.com/", "https://a.com/1", "https://a.com/2", "https://a.com/3", "https://a.com/4"];
    expect(() => reserveHit({ hitCount: 5, visitedUrls: visited }, "https://a.com/5", false)).toThrow(HitBudgetError);
    expect(() => reserveHit({ hitCount: 2, visitedUrls: visited.slice(0, 2) }, "https://a.com/1", false)).toThrow(/Already fetched/);
    expect(() => reserveHit({ hitCount: 0, visitedUrls: [] }, "https://a.com/pricing", false)).toThrow(/homepage/);
    expect(reserveHit({ hitCount: 0, visitedUrls: [] }, "https://a.com/", true).hitNumber).toBe(1);
  });

  it("retries a transient failure without consuming another unique-page hit", async () => {
    const pages = { ...QUALIFIED_SITE, "/": (n: number) => (n < 3 ? { status: 503, body: "busy" } : { status: 200, body: HOME_B2B }) };
    const { site, deps, state } = setup({ domain: DOMAIN, pages });
    const out = await runCompanyResearch(state, deps);
    const home = out.pages[0];
    expect(home.fetchStatus).toBe("ok");
    expect(home.attempts).toBe(3);
    expect(home.hitNumber).toBe(1);
    expect(out.retryCounts[`https://${DOMAIN}/`]).toBe(2);
    expect(site.attempts.get("/")).toBe(3);
    expect(out.hitCount).toBe(out.visitedUrls.length);
  });

  it("does not fetch the same URL twice even if it is linked repeatedly", async () => {
    const dup = page("Flowlane", `<h1>Workflow automation software for finance teams</h1><p>Flowlane is a cloud platform that helps finance teams at mid-market companies automate approvals.</p><a href="/pricing">Pricing</a><a href="/pricing/">Plans</a><a href="https://flowlane.io/pricing?utm_source=x">See pricing</a>`);
    const { site, deps, state } = setup({ domain: DOMAIN, pages: { ...QUALIFIED_SITE, "/": dup } });
    await runCompanyResearch(state, deps);
    expect(site.pageRequests().filter((r) => new URL(r).pathname.startsWith("/pricing"))).toHaveLength(1);
  });

  it("uses sitemap URLs instead of guessing paths, and sitemaps don't count as hits", async () => {
    const sitemap = `<?xml version="1.0"?><urlset><url><loc>https://${DOMAIN}/</loc></url><url><loc>https://${DOMAIN}/plans</loc></url></urlset>`;
    const home = page("Flowlane", `<h1>Workflow automation software for finance teams</h1><p>Flowlane is a cloud platform that helps finance teams at mid-market companies automate approvals and close faster.</p>`, "", false);
    const { site, deps, state } = setup({ domain: DOMAIN, pages: { "/": home, "/sitemap.xml": sitemap, "/plans": PRICING_ENTERPRISE } });
    const out = await runCompanyResearch(state, deps);
    expect(out.pages.map((p) => p.url)).toContain(`https://${DOMAIN}/plans`);
    expect(site.pageRequests().some((r) => /\/(security|careers|team)$/.test(r))).toBe(false); // nothing guessed
    expect(out.pages.find((p) => p.url.endsWith("/plans"))!.selectionReason).toMatch(/sitemap/);
  });
});

describe("qualification gates", () => {
  it("short-circuits an already-certified company after the homepage", async () => {
    const home = page("Ledgerly", `<h1>Accounting APIs for fintech companies</h1><p>Ledgerly is an API platform that lets fintech companies embed double-entry accounting in their products.</p>`, `<p>Ledgerly is SOC 2 Type II certified.</p><img src="/soc2.png" alt="SOC 2 Type II badge">`);
    const { site, deps, state } = setup({ domain: "ledgerly.com", pages: { "/": home, "/careers": NO_SIGNAL_PAGE("Careers") } });
    const out = await runCompanyResearch(state, deps);
    expect(out.qualification).toBe("disqualified");
    expect(out.certificationStatus).toBe("certified");
    expect(out.namedCertifications).toEqual(["SOC 2"]);
    expect(out.hitCount).toBe(1);
    expect(site.pageRequests()).toHaveLength(1);
    const gate = out.qualificationReasons.find((r) => r.gate === "certification")!;
    expect(gate.result).toBe("fail");
    expect(gate.evidence[0].supportingQuote).toMatch(/SOC 2/);
    expect(out.emailBody).toBeNull();
  });

  it("does not treat a compliance vendor's marketing as a certification it holds", async () => {
    const home = page("CertifyFast", `<h1>Get SOC 2 compliant in weeks</h1><p>CertifyFast is a compliance automation platform that helps startups and growing companies achieve SOC 2 and ISO 27001.</p>`);
    const { deps, state } = setup({ domain: "certifyfast.io", pages: { "/": home } });
    const out = await runCompanyResearch(state, deps);
    expect(out.namedCertifications).toEqual([]);
    expect(out.qualification).not.toBe("disqualified");
  });

  it("disqualifies a company when B2B SaaS is disproved", async () => {
    const home = page("SnackBox", `<h1>Healthy snacks delivered to your door</h1><p>SnackBox ships a monthly box of healthy snacks for you and your family, with free shipping on every order.</p><p>Shop now and add to cart your favourite flavours.</p>`);
    const { deps, state } = setup({ domain: "snackbox.com", pages: { "/": home } });
    const out = await runCompanyResearch(state, deps);
    expect(out.qualification).toBe("disqualified");
    expect(out.hitCount).toBe(1);
    expect(out.qualificationReasons.find((r) => r.gate === "b2b_saas")!.result).toBe("fail");
  });

  it("sends a B2B SaaS company with no stage evidence to manual review (and flags the outreach)", async () => {
    const { deps, state } = setup({ domain: DOMAIN, pages: { "/": HOME_B2B, "/careers": NO_SIGNAL_PAGE("Careers"), "/pricing": NO_SIGNAL_PAGE("Pricing"), "/team": TEAM_PAGE } });
    const out = await runCompanyResearch(state, deps);
    expect(out.qualification).toBe("manual_review");
    expect(out.qualificationReasons.find((r) => r.gate === "stage")!.result).toBe("unknown");
  });

  it("does not create a qualification from an empty page", async () => {
    const { deps, state } = setup({ domain: "ghost.io", pages: { "/": "<html><head><title></title></head><body><div id='root'></div></body></html>" } });
    const out = await runCompanyResearch(state, deps);
    expect(out.qualification).toBe("incomplete");
    expect(out.status).toBe("escalated");
    expect(out.stopReason).toMatch(/no readable text/);
  });

  it("every qualification reason has supporting evidence or is marked unknown", async () => {
    const { deps, state } = setup({ domain: DOMAIN, pages: QUALIFIED_SITE });
    const out = await runCompanyResearch(state, deps);
    expect(out.qualification).toBe("qualified");
    for (const r of out.qualificationReasons) {
      if (r.gate === "certification" && r.result === "pass") {
        expect(r.explanation).toMatch(/does not prove/); // absence of evidence, worded as uncertainty
        continue;
      }
      expect(r.result === "unknown" || r.evidence.length > 0).toBe(true);
      for (const e of r.evidence) expect(e.supportingQuote.length).toBeGreaterThan(0);
    }
    for (const e of out.evidence) expect(e.sourceUrl).toMatch(/^https:\/\/flowlane\.io/);
  });
});

describe("scraping barriers", () => {
  it("stops safely on a CAPTCHA challenge", async () => {
    const challenge = `<html><head><title>Just a moment...</title></head><body><div class="cf-browser-verification">Checking your browser</div></body></html>`;
    const { site, deps, state } = setup({ domain: "guarded.com", pages: { "/": { status: 403, body: challenge } } });
    const out = await runCompanyResearch(state, deps);
    expect(out.pages[0].fetchStatus).toBe("captcha");
    expect(out.status).toBe("escalated");
    expect(out.qualification).toBe("incomplete");
    expect(site.pageRequests()).toHaveLength(1);
    expect(out.stopReason).toMatch(/CAPTCHA/);
  });

  it("stops safely on a login wall", async () => {
    const login = `<html><head><title>Sign in</title></head><body><form><input type="email"><input type="password"><button>Sign in</button></form></body></html>`;
    const { deps, state } = setup({ domain: "portal.com", pages: { "/": { status: 302, headers: { location: "/login" } }, "/login": login } });
    const out = await runCompanyResearch(state, deps);
    expect(out.pages[0].fetchStatus).toBe("login_required");
    expect(out.status).toBe("escalated");
  });

  it("respects robots.txt disallow on the homepage", async () => {
    const { site, deps, state } = setup({ domain: "private.dev", pages: { "/robots.txt": "User-agent: *\nDisallow: /", "/": HOME_B2B } });
    const out = await runCompanyResearch(state, deps);
    expect(site.pageRequests()).toHaveLength(0);
    expect(out.hitCount).toBe(0);
    expect(out.stopReason).toMatch(/robots\.txt/);
  });

  it("reports an unreachable domain without crashing", async () => {
    const { deps, state } = setup({ domain: "nowhere-zzz.com", pages: {} });
    deps.fetchDeps = { ...deps.fetchDeps, resolve: async () => { const { DnsError } = await import("@/lib/security/ssrf"); throw new DnsError("ENOTFOUND"); } };
    const out = await runCompanyResearch(state, deps);
    expect(out.status).toBe("escalated");
    expect(out.stopReason).toMatch(/DNS/);
  });
});

describe("contact, pain points and email", () => {
  it("qualifies, picks the most relevant real person, writes two hypotheses and emails only the user", async () => {
    const mailer = recordingMailer();
    const { deps, state } = setup({ domain: DOMAIN, pages: QUALIFIED_SITE, mailer });
    const out = await runCompanyResearch(state, deps);
    expect(out.qualification).toBe("qualified");
    expect(out.contact?.name).toBe("Priya Raman"); // CTO beats CEO and Head of Marketing
    expect(out.contact?.source).toBe("website");
    expect(out.contactCandidates.map((c) => c.name)).not.toContain("Mark Fields"); // testimonial from another company
    expect(out.painPoints).toHaveLength(2);
    expect(out.painPoints.every((p) => p.label === "hypothesis" && p.evidenceUrls.length > 0)).toBe(true);
    expect(out.emailBody).toMatch(/^Hi Priya,/);
    expect(out.emailError).toBeNull();
    expect(out.emailStatus).toBe("sent");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe(SELF);
    expect(mailer.sent[0].body).toMatch(/Sent only to you/);
  });

  it("uses a contact provided in the input instead of searching for one", async () => {
    const { site, deps, state } = setup({ domain: DOMAIN, pages: QUALIFIED_SITE, manualContact: { name: "Jordan Blake", title: "Head of Security" } });
    const out = await runCompanyResearch(state, deps);
    expect(out.contact?.name).toBe("Jordan Blake");
    expect(out.contactStatus).toBe("manual");
    expect(out.emailBody).toMatch(/^Hi Jordan,/);
    expect(site.pageRequests().some((r) => r.endsWith("/team"))).toBe(false); // no hit spent looking
  });

  it("never invents a contact when no one is named, and addresses the team instead", async () => {
    const { deps, state } = setup({ domain: DOMAIN, pages: { "/": HOME_B2B, "/pricing": PRICING_ENTERPRISE, "/team": NO_SIGNAL_PAGE("Team") } });
    const out = await runCompanyResearch(state, deps);
    expect(out.qualification).toBe("qualified");
    expect(out.contact).toBeNull();
    expect(out.contactStatus).toBe("none_found");
    expect(out.emailBody).toMatch(/^Hi Flowlane team,/);
  });

  it("keeps the draft when Gmail delivery fails", async () => {
    const mailer = recordingMailer({ fail: true });
    const { deps, state } = setup({ domain: DOMAIN, pages: QUALIFIED_SITE, mailer });
    const out = await runCompanyResearch(state, deps);
    expect(out.emailStatus).toBe("failed");
    expect(out.emailBody).toBeTruthy();
    expect(out.emailSubject).toBeTruthy();
    expect(out.emailError).toMatch(/Gmail send failed/);
  });

  it("does not send anything when Gmail is not configured, but still shows the draft", async () => {
    const { deps, state } = setup({ domain: DOMAIN, pages: QUALIFIED_SITE, mailer: null });
    const out = await runCompanyResearch(state, deps);
    expect(out.emailStatus).toBe("not_configured");
    expect(out.emailBody).toMatch(/^Hi Priya,/);
  });
});

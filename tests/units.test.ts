import { describe, expect, it } from "vitest";
import { quoteIsSupported } from "@/lib/agent/evidence";
import { selectNextSource } from "@/lib/agent/source-selection";
import { extractPeople, rankPeople } from "@/lib/contacts/select";
import { deliverToSelf } from "@/lib/email/deliver";
import { assertRecipientAllowed, RecipientNotAllowedError, safeHeader } from "@/lib/email/gmail";
import { extractPageFacts } from "@/lib/extract/rules";
import { validateEmailDraft } from "@/lib/email/quality";
import { qualifyCompany } from "@/lib/qualify/gates";
import { extractMainContent } from "@/lib/scraper/clean";
import { fetchPage } from "@/lib/scraper/fetch";
import { discoverLinks } from "@/lib/scraper/links";
import { parseRobots } from "@/lib/scraper/robots";
import { parseDomainInput, parseResearchInput } from "@/lib/security/domain";
import { assertPublicUrl, isPrivateAddress } from "@/lib/security/ssrf";
import { initialState } from "@/lib/types";
import { HOME_B2B, SELF, fakeSite, fetchDepsFor, recordingMailer } from "./helpers";

describe("domain input", () => {
  it("normalises URLs, strips www, dedupes and rejects bad input with reasons", () => {
    const r = parseDomainInput("https://www.Stripe.com/pricing\nstripe.com, linear.app ; not a domain\nfoo@bar.com\n127.0.0.1\nlocalhost\nacme.internal\n", 10);
    expect(r.domains).toEqual(["stripe.com", "linear.app"]);
    const reasons = r.rejected.map((x) => x.reason).join(" | ");
    expect(reasons).toMatch(/Duplicate/);
    expect(reasons).toMatch(/email address/);
    expect(reasons).toMatch(/IP addresses/);
    expect(reasons).toMatch(/Private, local or reserved/);
    expect(r.rejected.some((x) => x.input === "not a domain")).toBe(true);
    expect(parseDomainInput("a.com b.io", 10).domains).toEqual(["a.com", "b.io"]);
  });
  it("enforces the per-job domain limit", () => {
    const r = parseDomainInput(["a.com", "b.com", "c.com"], 2);
    expect(r.domains).toHaveLength(2);
    expect(r.rejected[0].reason).toMatch(/limit/);
  });
  it("handles empty input", () => {
    expect(parseDomainInput("   \n ", 10).domains).toHaveLength(0);
  });
});

describe("SSRF protection", () => {
  it("classifies private and metadata ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });
  it("rejects unsafe URLs before any request is made", async () => {
    const resolvePrivate = async () => ["10.0.0.5"];
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/Blocked/);
    await expect(assertPublicUrl("ftp://example.com")).rejects.toThrow(/protocol/);
    await expect(assertPublicUrl("http://example.com:8080/")).rejects.toThrow(/port/);
    await expect(assertPublicUrl("http://user:pw@example.com/")).rejects.toThrow(/Credentials/);
    await expect(assertPublicUrl("https://rebind.example.com/", resolvePrivate)).rejects.toThrow(/private address/);
  });
  it("revalidates redirect destinations and blocks redirects to private hosts or off-site", async () => {
    const site = fakeSite("example.com", { "/": { status: 302, headers: { location: "http://127.0.0.1/admin" } }, "/a": { status: 301, headers: { location: "https://evil.com/" } } });
    const r1 = await fetchPage("https://example.com/", { siteDomain: "example.com", allowCrossSiteRedirect: true }, fetchDepsFor(site.fetchImpl));
    expect(r1.status).toBe("ssrf_blocked");
    const r2 = await fetchPage("https://example.com/a", { siteDomain: "example.com" }, fetchDepsFor(site.fetchImpl));
    expect(r2.status).toBe("ssrf_blocked");
  });
  it("enforces a maximum page size", async () => {
    const big = "<p>" + "x".repeat(3_000_000) + "</p>";
    const site = fakeSite("example.com", { "/": big });
    const r = await fetchPage("https://example.com/", { siteDomain: "example.com" }, fetchDepsFor(site.fetchImpl));
    expect(r.status).toBe("too_large");
  });
  it("skips permanent 404s without retrying and reports DNS failures", async () => {
    const site = fakeSite("example.com", {});
    const r = await fetchPage("https://example.com/nope", { siteDomain: "example.com" }, fetchDepsFor(site.fetchImpl));
    expect(r.status).toBe("not_found");
    expect(r.attempts).toBe(1);
    const dns = await fetchPage("https://nonexistent-zzz.com/", { siteDomain: "nonexistent-zzz.com" }, { ...fetchDepsFor(site.fetchImpl), resolve: async () => { const { DnsError } = await import("@/lib/security/ssrf"); throw new DnsError("ENOTFOUND"); } });
    expect(dns.status).toBe("dns_error");
  });
});

describe("cleaning", () => {
  it("drops nav, footer and cookie banners but keeps hero content and footer certification badges", () => {
    const html = `<html><head><title>Acme</title></head><body>
      <nav>Home Product Pricing Login Sign up</nav>
      <div id="onetrust-banner">We use cookies to improve your experience. Accept all cookies now please.</div>
      <main><h1>Compliance-ready payroll for remote teams</h1><p>Acme runs payroll for distributed companies in 40 countries with one platform and one invoice.</p>
      <p>Acme runs payroll for distributed companies in 40 countries with one platform and one invoice.</p></main>
      <footer><p>© 2026 Acme. SOC 2 Type II certified.</p><img alt="ISO 27001 certified badge"></footer>
      <script>window.analytics = {}</script></body></html>`;
    const c = extractMainContent(html);
    expect(c.text).toMatch(/Compliance-ready payroll/);
    expect(c.text).not.toMatch(/cookies/);
    expect(c.text).not.toMatch(/Sign up/);
    expect(c.text).not.toMatch(/analytics/);
    expect(c.text.match(/Acme runs payroll/g)).toHaveLength(1);
    expect(c.footerSignals.join(" ")).toMatch(/SOC 2 Type II/);
    expect(c.footerSignals.join(" ")).toMatch(/ISO 27001/);
  });
  it("caps the model input size", () => {
    const paras = Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i} describes our enterprise software platform for business teams in plenty of detail.</p>`).join("");
    const c = extractMainContent(`<html><body><main><h1>Title</h1>${paras}</main></body></html>`, 6000);
    expect(c.text.length).toBeLessThanOrEqual(6000);
  });
  it("flags a JavaScript app shell", () => {
    const c = extractMainContent(`<html><head>${"<script></script>".repeat(6)}</head><body><div id="root"></div></body></html>`);
    expect(c.looksJsRendered).toBe(true);
  });
  it("discovers same-site research links and ignores off-site, blog and login links", () => {
    const links = discoverLinks(HOME_B2B + `<a href="https://twitter.com/x">X</a><a href="/blog/post-1">Blog</a><a href="/login">Login</a><a href="https://boards.greenhouse.io/flowlane">Jobs</a>`, "https://flowlane.io/", "flowlane.io");
    const urls = links.map((l) => l.url);
    expect(urls).toContain("https://flowlane.io/careers");
    expect(urls).toContain("https://flowlane.io/security");
    expect(urls).toContain("https://boards.greenhouse.io/flowlane");
    expect(urls.some((u) => u.includes("twitter") || u.includes("/blog") || u.includes("/login"))).toBe(false);
  });
});

describe("robots.txt", () => {
  it("applies longest-match allow/disallow for our agent group", () => {
    const p = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: OtherBot\nDisallow: /");
    expect(p.isAllowed("/")).toBe(true);
    expect(p.isAllowed("/private/x")).toBe(false);
    expect(p.isAllowed("/private/ok/page")).toBe(true);
    expect(parseRobots(null).isAllowed("/anything")).toBe(true);
  });
});

describe("evidence and gates", () => {
  it("matches quotes verbatim after normalisation, including ellipses", () => {
    const content = "Flowlane is a cloud platform that helps finance teams — at mid-market companies.";
    expect(quoteIsSupported("Flowlane is a cloud platform", content)).toBe(true);
    expect(quoteIsSupported("Flowlane is a cloud platform ... mid-market companies", content)).toBe(true);
    expect(quoteIsSupported("Flowlane raised a Series B", content)).toBe(false);
    expect(quoteIsSupported("", content)).toBe(false);
  });
  it("selects no source once the company is disqualified or the budget is spent", () => {
    const s = initialState({ id: "c", domain: "a.com" });
    s.candidateLinks = [{ url: "https://a.com/careers", pageType: "careers", anchorText: "Careers", source: "homepage_link", score: 90 }];
    expect(selectNextSource({ ...s, hitCount: 5 })).toBeNull();
    expect(selectNextSource({ ...s, hitCount: 1, qualification: "disqualified" })).toBeNull();
    const sel = selectNextSource({ ...s, hitCount: 1, certificationStatus: "not_found", isSaas: true, isB2B: true, contact: { name: "A B", title: "CTO", source: "manual", sourceUrl: null, supportingQuote: null, selectionReason: "" } });
    expect(sel?.pageType).toBe("careers");
    expect(sel?.reason).toMatch(/Stage evidence missing/);
  });
  it("returns incomplete when nothing was read", () => {
    expect(qualifyCompany(initialState({ id: "c", domain: "a.com" })).qualification).toBe("incomplete");
  });
});

describe("contact discovery from the website", () => {
  it("pairs names with titles, ranks by role and rejects testimonials from other companies", () => {
    const people = extractPeople(["Priya Raman", "Co-founder & CTO", "Sam Lee", "Head of Marketing", "Ana Ortiz, CEO", "Mark Fields, CFO at Globex", "Johnny Ho", "Co-founder at Perplexity", "Get Started", "Book a demo"], "https://x.com/team", ["x"]);
    const ranked = rankPeople(people);
    expect(ranked.map((r) => r.name)).toEqual(["Priya Raman", "Ana Ortiz"]);
    expect(ranked[0].selectionReason).toMatch(/CTO/);
  });
  it("finds founders named in prose", () => {
    const people = extractPeople(["Acme was founded by Jane Doe and John Roe in 2021 to fix payroll."], "https://acme.com/about", ["acme"]);
    expect(people.map((p) => p.name)).toEqual(["Jane Doe", "John Roe"]);
  });
});

describe("research input", () => {
  it("accepts domains with an optional known contact", () => {
    const r = parseResearchInput("acme.com | Priya Raman | CTO\nlinear.app\nbeta.io, Sam Lee, Head of Security\na.com b.com", 10);
    expect(r.entries).toEqual([
      { domain: "acme.com", manualContact: { name: "Priya Raman", title: "CTO" } },
      { domain: "linear.app", manualContact: null },
      { domain: "beta.io", manualContact: { name: "Sam Lee", title: "Head of Security" } },
      { domain: "a.com", manualContact: null },
      { domain: "b.com", manualContact: null },
    ]);
  });
  it("rejects a bad contact name with a reason", () => {
    const r = parseResearchInput("acme.com | x | CTO", 10);
    expect(r.entries).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/full name/);
  });
});

describe("rule-based extraction", () => {
  it("extracts product, buyer, funding, enterprise and compliance signals with verbatim quotes", () => {
    const content = ["Title: Acme | Payroll for global teams", "Description: Acme is a payroll platform for distributed companies.", "We raised a $20M Series B led by Accel to expand in Europe.", "Enterprise plan with SSO and custom pricing.", "We sign a Data Processing Agreement with every customer under GDPR."].join("\n");
    const f = extractPageFacts({ content, pageType: "homepage" });
    expect(f.company_name).toBe("Acme");
    expect(f.is_software_product).toBe("yes");
    expect(f.sells_to_businesses).toBe("yes");
    expect(f.funding_stage).toBe("series_b");
    expect(f.funding_quote).toMatch(/Series B/);
    expect(f.enterprise_signals.map((e) => e.signal)).toContain("Enterprise plan / tier");
    expect(f.compliance_signals.map((e) => e.signal)).toContain("GDPR obligations mentioned");
  });
  it("counts open roles on a careers page", () => {
    const f = extractPageFacts({ content: "Title: Careers\nJoin us", pageType: "careers", shortLines: ["Senior Backend Engineer", "Product Designer", "Security Engineer", "Account Executive", "Engineering Manager", "Why join us", "Benefits"] });
    expect(f.open_roles.map((r) => r.title)).toEqual(["Senior Backend Engineer", "Product Designer", "Security Engineer", "Account Executive", "Engineering Manager"]);
    expect(f.compliance_signals.some((c) => /Security Engineer/.test(c.signal))).toBe(true);
  });
});

describe("email safety", () => {
  it("refuses any recipient other than GMAIL_USER_EMAIL", () => {
    process.env.GMAIL_USER_EMAIL = SELF;
    expect(() => assertRecipientAllowed(SELF)).not.toThrow();
    expect(() => assertRecipientAllowed("ME@EXAMPLE.COM")).not.toThrow();
    expect(() => assertRecipientAllowed("prospect@company.com")).toThrow(RecipientNotAllowedError);
    delete process.env.GMAIL_USER_EMAIL;
    expect(() => assertRecipientAllowed(SELF)).toThrow(RecipientNotAllowedError);
    process.env.GMAIL_USER_EMAIL = SELF;
  });
  it("prevents header injection in the subject", () => {
    expect(safeHeader("hi\r\nBcc: victim@x.com")).not.toMatch(/[\r\n]/);
  });
  it("prevents duplicate sends of the same draft", async () => {
    process.env.GMAIL_USER_EMAIL = SELF;
    const mailer = recordingMailer();
    const a = await deliverToSelf(mailer, SELF, { subject: "dup-test", body: "same body" }, "run-1");
    const b = await deliverToSelf(mailer, SELF, { subject: "dup-test", body: "same body" }, "run-1");
    const c = await deliverToSelf(mailer, SELF, { subject: "dup-test", body: "same body" }, "run-2");
    expect(a.status).toBe("sent");
    expect(b.duplicate).toBe(true);
    expect(c.duplicate).toBeUndefined(); // a fresh research run may send again
    expect(mailer.sent).toHaveLength(2);
  });
  it("flags generic or ungrounded emails", () => {
    const problems = validateEmailDraft(
      { subject: "quick question", body: "Hello there, I hope this email finds you well. Short.", hook_quote: "made up", hook_source_url: "", rationale: "" },
      { firstName: "Priya", evidence: [] },
    );
    expect(problems.join(" ")).toMatch(/first name/);
    expect(problems.join(" ")).toMatch(/banned/);
    expect(problems.join(" ")).toMatch(/not grounded/);
  });
});

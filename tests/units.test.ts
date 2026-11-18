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
  it("rejects testimonial titles that name another employer in any form", async () => {
    const { worksElsewhere } = await import("@/lib/contacts/select");
    const keys = ["zoho"];
    expect(worksElsewhere("CEO, 5paisa.com (an IIFL subsidiary)", keys)).toBe(true);
    expect(worksElsewhere("Head of IT at Globex", keys)).toBe(true);
    expect(worksElsewhere("CTO @ Initech", keys)).toBe(true);
    expect(worksElsewhere("Founder, Acme Corp", keys)).toBe(true);
    expect(worksElsewhere("Co-founder & CTO", keys)).toBe(false);
    expect(worksElsewhere("Co-CEO & Board Chairman", keys)).toBe(false);
    expect(worksElsewhere("VP Engineering at Zoho", keys)).toBe(false);
    expect(worksElsewhere("Head of Security, Zoho Corporation", keys)).toBe(false);
  });
  it("finds people in press-style quotes and cleans social labels from titles", () => {
    const a = extractPeople(['"We are thrilled," said Jane Doe, CEO of Acme, in a statement.'], "https://acme.com/press", ["acme"]);
    expect(a.map((p) => `${p.name}|${p.title}`)).toEqual(["Jane Doe|CEO at Acme"]);
    const b = extractPeople(["John Roe, co-founder and CTO, said the launch was the result of two years of work."], "https://acme.com/press", ["acme"]);
    expect(b.map((p) => p.name)).toEqual(["John Roe"]);
    const c = extractPeople(['"Great product," said Mark Fields, CFO at Globex.'], "https://acme.com/", ["acme"]);
    expect(c).toEqual([]); // works elsewhere: a testimonial
    const d = extractPeople(["August Flanagan", "Co-Founder · LinkedIn"], "https://acme.com/about", ["acme"]);
    expect(d[0].title).toBe("Co-Founder");
  });
  it("finds founders in an origin-story sentence", () => {
    const a = extractPeople(["Uku Taht started Plausible in December 2018, building it alone."], "https://plausible.io/about", ["plausible"]);
    expect(a.map((p) => `${p.name}|${p.title}`)).toEqual(["Uku Taht|Founder"]);
    expect(extractPeople(["Jane Doe and John Roe founded Acme to fix payroll."], "https://acme.com/about", ["acme"]).map((p) => p.name)).toEqual(["Jane Doe", "John Roe"]);
    expect(extractPeople(["Rob Hope started using Acme last year."], "https://acme.com/", ["acme"])).toEqual([]);
  });
  it("finds founders named in prose", () => {
    const people = extractPeople(["Acme was founded by Jane Doe and John Roe in 2021 to fix payroll."], "https://acme.com/about", ["acme"]);
    expect(people.map((p) => p.name)).toEqual(["Jane Doe", "John Roe"]);
  });
});

describe("email openers", () => {
  it("turns every enterprise signal label into a grammatical sentence", async () => {
    const { enterpriseHook } = await import("@/lib/outreach/email");
    for (const label of ["Enterprise plan / tier", "SSO / SAML for enterprise customers", "Sales-led custom pricing", "Enterprise features (audit logs, SLA, dedicated manager)", "Sells to large enterprises"]) {
      const s = enterpriseHook("Acme", label);
      expect(s).toMatch(/^I noticed Acme/);
      expect(s).not.toMatch(/offers sells|offers enterprise plan \//i);
    }
  });
});

describe("research input", () => {
  it("accepts domains with an optional known contact", () => {
    const r = parseResearchInput("acme.com | Priya Raman | CTO\nlinear.app\nbeta.io, Sam Lee, Head of Security\na.com b.com", 10);
    expect(r.entries.map(({ domain, manualContact }) => ({ domain, manualContact }))).toEqual([
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
  it("never counts advice to the reader as a certification held", () => {
    expect(extractPageFacts({ content: "Title: Pay\nTo accept card payments, your company must always be PCI DSS compliant.", pageType: "security" }).certifications_held).toEqual([]);
  });
  it("takes only section roots from a sitemap", async () => {
    const { sitemapCandidates } = await import("@/lib/scraper/links");
    const urls = ["https://x.com/trust/slavery-statement", "https://x.com/trust", "https://x.com/careers/backend-engineer", "https://x.com/company/careers", "https://x.com/pricing"];
    expect(sitemapCandidates(urls, "x.com", []).map((c) => c.url).sort()).toEqual(["https://x.com/company/careers", "https://x.com/pricing", "https://x.com/trust"]);
  });
  it("never counts a certification that is planned or in progress as held", () => {
    for (const line of ["We are working towards SOC 2 Type II certification.", "Our SOC 2 audit is in progress and we expect to be certified in Q3.", "We plan to achieve ISO 27001 certification next year."]) {
      expect(extractPageFacts({ content: `Title: Acme\n${line}`, pageType: "security" }).certifications_held, line).toEqual([]);
    }
    expect(extractPageFacts({ content: "Title: Acme\nWe are SOC 2 Type II certified.", pageType: "homepage" }).certifications_held.map((c) => c.name)).toEqual(["SOC 2"]);
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

describe("page classification", () => {
  it("classifies by the deciding path segment, not any segment", async () => {
    const { classifyPage } = await import("@/lib/scraper/classify");
    const cases: Record<string, string> = {
      "/teams/security": "team", "/security": "security", "/company/security": "security", "/trust": "security", "/en/security": "security",
      "/company/careers": "careers", "/careers": "careers", "/careers/ai-engineer": "careers", "/teams/people": "team", "/team": "team",
      "/pricing": "pricing", "/en-us/pricing": "pricing", "/blog/security-best-practices": "other", "/customers/acme": "customers",
      "/about": "about", "/company": "about", "/handbook/security": "other", "/docs/pricing": "other", "/legal/security": "security",
    };
    const wrong = Object.entries(cases).filter(([p, want]) => classifyPage(`https://x.com${p}`) !== want).map(([p, want]) => `${p}: got ${classifyPage(`https://x.com${p}`)}, want ${want}`);
    expect(wrong).toEqual([]);
  });
});

describe("API input formats (for automated test scripts)", () => {
  it("accepts every reasonable request shape", async () => {
    const { normalizeResearchRequest: n } = await import("@/lib/api-format");
    expect(n({ domains: "a.com\nb.io" })).toEqual(["a.com\nb.io"]);
    expect(n({ domains: ["a.com", "b.io"] })).toEqual(["a.com", "b.io"]);
    expect(n({ domain: "a.com" })).toEqual(["a.com"]);
    expect(n({ url: "https://www.a.com" })).toEqual(["https://www.a.com"]);
    expect(n({ urls: ["a.com"] })).toEqual(["a.com"]);
    expect(n({ websites: "a.com, b.io" })).toEqual(["a.com, b.io"]);
    expect(n({ companies: ["a.com"] })).toEqual(["a.com"]);
    expect(n({ input: "a.com" })).toEqual(["a.com"]);
    expect(n(["a.com", "b.io"])).toEqual(["a.com", "b.io"]);
    expect(n("a.com")).toEqual(["a.com"]);
    expect(n([{ domain: "a.com", contact_name: "Jane Doe", contact_title: "CTO" }])).toEqual(["a.com | Jane Doe | CTO"]);
    expect(n({ companies: [{ website: "a.com", poc: { name: "Jane Doe", title: "CTO" } }] })).toEqual(["a.com | Jane Doe | CTO"]);
    expect(n({ domain: "a.com", contact_name: "Jane Doe", title: "Head of Security" })).toEqual(["a.com | Jane Doe | Head of Security"]);
    expect(n({ data: { domains: ["a.com"] } })).toEqual(["a.com"]);
  });
  it("returns null when nothing usable is present", async () => {
    const { normalizeResearchRequest: n } = await import("@/lib/api-format");
    expect(n({ hello: "world" })).toBeNull();
    expect(n(42)).toBeNull();
    expect(n(null)).toBeNull();
    expect(n([1, 2])).toBeNull();
  });
});

describe("email variety", () => {
  it("writes different emails for different companies, and the same email for the same company", async () => {
    const { generateEmail } = await import("@/lib/outreach/email");
    const { validateEmailDraft } = await import("@/lib/email/quality");
    const ev = (domain: string) => ({ field: "enterprise_signal", value: "SSO / SAML for enterprise customers", sourceUrl: `https://${domain}/pricing`, sourceTitle: "Pricing", extractedAt: "", confidence: 0.75, supportingQuote: "Enterprise plan with SSO and SAML" });
    const mk = (domain: string) => {
      const s = initialState({ id: domain, domain, manualContact: { name: "Jane Doe", title: "CTO" } });
      s.companyName = domain.split(".")[0];
      s.evidence = [ev(domain)];
      return generateEmail(s, ["enterprise", "no_cert"], [ev(domain)]);
    };
    const domains = ["alpha.io", "bravo.com", "charlie.ai", "delta.co", "echo.app", "foxtrot.dev"];
    const bodies = domains.map((d) => mk(d).body.replace(new RegExp(d.split(".")[0], "g"), "X"));
    expect(new Set(bodies).size).toBeGreaterThanOrEqual(4); // varied wording across companies
    expect(mk("alpha.io").body).toBe(mk("alpha.io").body); // stable per company
    for (const d of domains) {
      const e = mk(d);
      expect(validateEmailDraft(e, { firstName: "Jane", evidence: [ev(d)] }), `${d}: ${e.body}`).toEqual([]);
      expect(e.body).toMatch(/^(Hi|Hello) Jane,/);
    }
  });
});

describe("email grammar", () => {
  it("forms possessives correctly", async () => {
    const { possessive } = await import("@/lib/outreach/email");
    expect(possessive("Acme")).toBe("Acme's");
    expect(possessive("Plausible Analytics")).toBe("Plausible Analytics'");
  });
});

describe("dashboard analytics", () => {
  it("computes totals, daily series, calendar and verdict shares from stored runs", async () => {
    const { computeAnalytics } = await import("@/lib/analytics");
    const mk = (domain: string, q: "qualified" | "disqualified", sent: boolean) => {
      const s = initialState({ id: domain, domain });
      s.qualification = q;
      s.emailStatus = sent ? "sent" : "none";
      s.emailBody = sent ? "Hi" : null;
      s.hitCount = 2;
      s.pages = [{ url: `https://${domain}/`, pageType: "homepage", hitNumber: 1, fetchStatus: "ok", httpStatus: 200, selectionReason: "", targetField: null, title: "", wordCount: 100, attempts: 1, fetchedAt: "" }, { url: `https://${domain}/security`, pageType: "security", hitNumber: 2, fetchStatus: "ok", httpStatus: 200, selectionReason: "", targetField: null, title: "", wordCount: 100, attempts: 1, fetchedAt: "" }];
      s.evidence = [{ field: "certification", value: "SOC 2", sourceUrl: `https://${domain}/security`, sourceTitle: "", extractedAt: "", confidence: 0.9, supportingQuote: "SOC 2" }];
      return s;
    };
    const now = new Date(2026, 10, 17, 12);
    const runs = [{ id: "r1", createdAt: new Date(2026, 10, 17, 9).toISOString(), input: "", rejected: [], results: [mk("a.com", "qualified", true), mk("b.com", "disqualified", false)] }];
    const a = computeAnalytics(runs, 7, now);
    expect(a.totals.researched).toBe(2);
    expect(a.totals.qualified).toBe(1);
    expect(a.totals.emailsSent).toBe(1);
    expect(a.qualifiedRate).toBe(0.5);
    expect(a.daily).toHaveLength(7);
    expect(a.daily[6]).toMatchObject({ label: "17 Nov", researched: 2, qualified: 1 });
    expect(a.calendar.days.find((d) => d.day === 17)?.runs).toBe(1);
    expect(a.pagesByType.find((p) => p.type === "security")?.count).toBe(2);
    expect(a.verdicts.find((v) => v.key === "qualified")?.share).toBe(0.5);
    expect(a.topSignals[0]).toEqual({ label: "Certified: SOC 2", count: 2 });
    expect(computeAnalytics([], 7, now).qualifiedRate).toBeNull(); // empty state never divides by zero
  });
});

describe("domain input parser (pasted lists, URLs, company names)", () => {
  const domainsOf = (text: string) => parseResearchInput(text, 25).entries.map((e) => e.domain);

  it("acceptance: '1. Zoho — https://www.zoho.com' → zoho.com", () => {
    const r = parseResearchInput("1. Zoho — https://www.zoho.com", 10);
    expect(r.entries.map((e) => e.domain)).toEqual(["zoho.com"]);
    expect(r.rejected).toEqual([]);
  });

  it("accepts bare domains, full URLs, www URLs and numbered / bulleted lists", () => {
    const input = [
      "zoho.com",
      "https://www.freshworks.com",
      "www.razorpay.com",
      "1. Chargebee - https://www.chargebee.com",
      "2) Postman: postman.com",
      "(3) BrowserStack — https://browserstack.com/",
      "#4 Darwinbox – darwinbox.com",
      "- Icertis https://www.icertis.com",
      "* Zenoti (zenoti.com)",
      "• Whatfix → https://whatfix.com",
      "[ ] Leadsquared leadsquared.com",
    ].join("\n");
    expect(domainsOf(input)).toEqual(["zoho.com", "freshworks.com", "razorpay.com", "chargebee.com", "postman.com", "browserstack.com", "darwinbox.com", "icertis.com", "zenoti.com", "whatfix.com", "leadsquared.com"]);
  });

  it("lowercases, strips www, paths, query strings, fragments, ports and trailing punctuation", () => {
    expect(domainsOf("HTTPS://WWW.Acme.COM/Pricing?utm_source=x&a=1#plans")).toEqual(["acme.com"]);
    expect(domainsOf("acme.io/about-us.")).toEqual(["acme.io"]);
    expect(domainsOf("Visit https://www.beta.dev:443/x, thanks!")).toEqual(["beta.dev"]);
    expect(domainsOf('"gamma.ai"')).toEqual(["gamma.ai"]);
  });

  it("deduplicates domains and reports the duplicates", () => {
    const r = parseResearchInput("1. Zoho — https://www.zoho.com\nzoho.com\nhttps://zoho.com/crm", 10);
    expect(r.entries.map((e) => e.domain)).toEqual(["zoho.com"]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["Duplicate of zoho.com", "Duplicate of zoho.com"]);
  });

  it("never silently discards: entries without a domain are rejected with a reason", () => {
    const r = parseResearchInput("3. Acme Corp\nstripe.com, linear.app ; not a domain\na.com, garbage, b.io", 10);
    expect(r.entries.map((e) => e.domain)).toEqual(["stripe.com", "linear.app", "a.com", "b.io"]);
    expect(r.rejected.map((x) => x.input)).toEqual(["3. Acme Corp", "not a domain", "garbage"]);
    for (const x of r.rejected) expect(x.reason).toMatch(/No domain or URL found/);
  });

  it("keeps a company name next to its URL as one entry", () => {
    const r = parseResearchInput("Zoho, https://zoho.com", 10);
    expect(r.entries.map((e) => e.domain)).toEqual(["zoho.com"]);
    expect(r.rejected).toEqual([]);
    expect(r.entries[0].source).toBe("Zoho, https://zoho.com");
  });

  it("still supports an optional known contact", () => {
    const r = parseResearchInput("1. Infisical — https://infisical.com | Milos Vetesnik | Co-founder\ntwenty.com, Charles Bochet, CEO", 10);
    expect(r.entries).toMatchObject([
      { domain: "infisical.com", manualContact: { name: "Milos Vetesnik", title: "Co-founder" } },
      { domain: "twenty.com", manualContact: { name: "Charles Bochet", title: "CEO" } },
    ]);
  });

  it("rejects localhost, private / metadata IPs, internal hosts and emails, each with a reason", () => {
    const r = parseResearchInput(["http://localhost:3000", "localhost", "127.0.0.1", "10.0.0.5", "192.168.1.1", "http://169.254.169.254/latest/meta-data", "metadata.google.internal", "vault.corp", "[::1]", "ceo@acme.com", "ftp://files.acme.com"].join("\n"), 20);
    expect(r.entries).toEqual([]);
    const reasons = r.rejected.map((x) => x.reason).join(" | ");
    expect(r.rejected).toHaveLength(11);
    expect(reasons).toMatch(/Private, local or reserved/);
    expect(reasons).toMatch(/IP addresses are not allowed/);
    expect(reasons).toMatch(/email address/);
    expect(reasons).toMatch(/Only http\(s\)/);
  });

  it("enforces the per-job limit after deduplication", () => {
    const r = parseResearchInput("a.com\nb.com\na.com\nc.com", 2);
    expect(r.entries.map((e) => e.domain)).toEqual(["a.com", "b.com"]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["Duplicate of a.com", "Exceeds the limit of 2 domains per job"]);
  });
});

describe("connect-time SSRF guard (DNS rebinding)", () => {
  it("refuses to open a socket to a private address even if the pre-check passed", async () => {
    const { makeSafeLookup } = await import("@/lib/security/ssrf");
    const rebinding = makeSafeLookup((_h, _o, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }]));
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => rebinding("rebind.example.com", { all: true }, (e) => resolve(e)));
    expect(err?.code).toBe("ESSRF");
    const publicHost = makeSafeLookup((_h, _o, cb) => cb(null, [{ address: "93.184.216.34", family: 4 }]));
    const ok = await new Promise<string | undefined>((resolve) => publicHost("example.com", {}, (_e, addr) => resolve(addr as string)));
    expect(ok).toBe("93.184.216.34");
  });
});

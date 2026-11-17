// The adaptive research agent: a LangGraph state machine over one shared ResearchState.
//
//   initialize_research ─▶ fetch_page ─▶ clean_content ─▶ extract_facts ─▶ validate_required_fields
//                             ▲   │                                           │         │
//                             │   └──(blocked / failed)───────────┐           │         │
//                             │                                    ▼          ▼         ▼
//                      select_next_source ◀── (missing & hits left)      qualify_company
//                                                                              │
//            discover_contact ◀── qualified ───────────────────────────────────┤
//                 │                                                            │ (not qualified)
//            identify_pain_points ─▶ generate_email ─▶ save_results ◀──────────┘
//                                                         │   (Gmail → your own inbox)
//                                                  complete_or_escalate ─▶ END
//
// Termination is guaranteed three ways: the five-hit budget (reserveHit throws before any
// request), a loop-iteration cap, and LangGraph's recursion limit.
// Every node emits the updated state, so the UI can show progress live.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { extractPeople, rankPeople } from "@/lib/contacts/select";
import { buildSelfEmail, deliverToSelf } from "@/lib/email/deliver";
import type { Mailer } from "@/lib/email/gmail";
import { validateEmailDraft } from "@/lib/email/quality";
import { extractPageFacts } from "@/lib/extract/rules";
import { generateEmail } from "@/lib/outreach/email";
import { identifyPainPoints } from "@/lib/outreach/painpoints";
import { isShortCircuited, missingRequiredFields, qualifyCompany } from "@/lib/qualify/gates";
import { detectCaptcha, detectLoginWall } from "@/lib/scraper/barriers";
import { classifyPage } from "@/lib/scraper/classify";
import { extractMainContent } from "@/lib/scraper/clean";
import { fetchPage, fetchRobotsTxt, fetchSitemapUrls, type FetchDeps } from "@/lib/scraper/fetch";
import { canonicalizeUrl, discoverLinks, guessedCandidates, sitemapCandidates } from "@/lib/scraper/links";
import { parseRobots, type RobotsPolicy } from "@/lib/scraper/robots";
import { isSameSite } from "@/lib/security/domain";
import { MAX_HITS, type FetchStatus, type PageRecord, type PageType, type ResearchState, type StageKey } from "@/lib/types";
import { extractCompanyFacts } from "./evidence";
import { HitBudgetError, reserveHit } from "./hit-budget";
import { fieldLimit, needsContact, selectNextSource } from "./source-selection";

/** og:site_name, else the title segment containing the domain name, else the domain name itself. */
export function companyNameFrom(siteName: string | null, title: string, domain: string): string {
  const root = domain.split(".")[0];
  if (siteName && siteName.length <= 40) return siteName;
  const seg = title.split(/\s[|–—-]\s|:\s/).map((x) => x.trim()).find((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "").includes(root.replace(/[^a-z0-9]/g, "")));
  if (seg && seg.split(" ").length <= 4) return seg;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

/** Outreach runs for QUALIFIED companies, and for MANUAL REVIEW ones where only stage is unconfirmed (flagged). */
export function outreachEligible(s: Pick<ResearchState, "qualification" | "qualificationReasons">): boolean {
  if (s.qualification === "qualified") return true;
  if (s.qualification !== "manual_review") return false;
  const g = (k: string) => s.qualificationReasons.find((r) => r.gate === k);
  const tooBig = g("stage")?.evidence.some((e) => e.field === "late_stage_signal");
  return g("b2b_saas")?.result === "pass" && g("certification")?.result === "pass" && !tooBig;
}

export interface AgentDeps {
  fetchDeps: FetchDeps;
  mailer: Mailer | null;
  selfEmail: string | null;
  autoSend: boolean;
  now: () => Date;
  /** Called after every node with the latest state (for live progress). */
  onUpdate?: (state: ResearchState) => void;
}

const MAX_LOOP_ITERATIONS = 8;

const GraphState = Annotation.Root({
  research: Annotation<ResearchState>(),
  next: Annotation<string>(),
});
type GS = typeof GraphState.State;
type NodeResult = { research: ResearchState; next: string };

interface PendingPage { url: string; finalUrl: string; pageType: PageType; html: string }

export function buildResearchGraph(deps: AgentDeps) {
  const robotsCache = new Map<string, RobotsPolicy>();
  const robotsRaw = new Map<string, string | null>();
  let pending: PendingPage | null = null; // raw HTML lives only in memory for one hop
  let cleaned: { url: string; pageType: PageType; title: string; text: string; shortLines: string[] } | null = null;
  let painResult: ReturnType<typeof identifyPainPoints> | null = null;

  const stage = (s: ResearchState, st: StageKey): ResearchState => ({ ...s, stage: st, status: s.status === "escalated" ? "escalated" : "running" });
  const log = (s: ResearchState, st: string, event: string, details: Record<string, unknown> = {}): ResearchState => ({
    ...s,
    log: [...s.log, { at: deps.now().toISOString(), stage: st, event, details }],
  });

  const node = (fn: (s: ResearchState) => Promise<NodeResult> | NodeResult) => async (gs: GS): Promise<Partial<GS>> => {
    const out = await fn(gs.research);
    deps.onUpdate?.(out.research);
    return out;
  };

  async function robotsFor(origin: string): Promise<RobotsPolicy> {
    if (!robotsCache.has(origin)) {
      const raw = await fetchRobotsTxt(origin, deps.fetchDeps);
      robotsRaw.set(origin, raw);
      robotsCache.set(origin, parseRobots(raw));
    }
    return robotsCache.get(origin)!;
  }

  // 1. initialize_research
  const initialize = node((s0) => {
    const s = log({ ...stage(s0, "homepage_fetch"), startedAt: deps.now().toISOString() }, "initialize_research", "started", { domain: s0.domain, manualContact: s0.contact?.name ?? null });
    return { research: s, next: "fetch_page" };
  });

  // 2. fetch_page
  const fetchPageNode = node(async (s0) => {
    const isHome = s0.hitCount === 0;
    const target = isHome ? `https://${s0.domain}/` : s0.nextResearchTarget;
    let s = stage(s0, isHome ? "homepage_fetch" : "adaptive_research");
    if (!target) return { research: s, next: "validate_required_fields" };
    const candidate = s.candidateLinks.find((c) => c.url === target);
    const pageType: PageType = isHome ? "homepage" : candidate?.pageType ?? classifyPage(target);
    const targetField = isHome ? null : s.nextResearchField;
    const reason = isHome ? "Hit 1 is always the homepage: it establishes the company, product, buyer and any certification badges." : s.nextResearchReason ?? "Selected to resolve a missing fact.";

    // robots.txt is respected; fetching it is access-policy metadata, not a page hit.
    const parsed = new URL(target);
    if (!(await robotsFor(parsed.origin)).isAllowed(parsed.pathname)) {
      s = log(s, "fetch_page", "robots_disallowed", { url: target });
      if (isHome) {
        const message = "robots.txt disallows automated access to the homepage; research stopped.";
        return { research: { ...s, stopReason: message, qualification: "incomplete", errors: [...s.errors, message], status: "escalated" }, next: "complete_or_escalate" };
      }
      return { research: { ...s, candidateLinks: s.candidateLinks.filter((c) => c.url !== target), nextResearchTarget: null }, next: "validate_required_fields" };
    }

    // Reserve the unique-page hit BEFORE any network request. Retries reuse it.
    let hitNumber: number;
    try {
      const r = reserveHit(s, target, isHome);
      hitNumber = r.hitNumber;
      s = { ...s, hitCount: r.hitCount, visitedUrls: r.visitedUrls };
    } catch (err) {
      if (!(err instanceof HitBudgetError)) throw err;
      s = log({ ...s, nextResearchTarget: null }, "fetch_page", "hit_refused", { url: target, reason: err.message });
      return { research: s, next: err.code === "exhausted" ? "qualify_company" : "validate_required_fields" };
    }
    const canonical = canonicalizeUrl(target) ?? target;
    if (targetField) s = { ...s, fieldAttempts: { ...s.fieldAttempts, [targetField]: (s.fieldAttempts[targetField] ?? 0) + 1 } };
    s = log({ ...s, nextResearchTarget: null }, "fetch_page", "fetch_started", { url: canonical, hit: `${hitNumber}/${MAX_HITS}`, pageType, reason });
    deps.onUpdate?.({ ...s, nextResearchTarget: canonical, nextResearchReason: reason });

    const r = await fetchPage(target, { siteDomain: s.siteHost, allowCrossSiteRedirect: isHome }, deps.fetchDeps);
    let status: FetchStatus = r.status;
    let words = 0;
    if (status === "ok" && r.html) {
      const quick = extractMainContent(r.html, 2000);
      words = quick.wordCount;
      if (detectCaptcha(r.html, words)) status = "captcha";
      else if (detectLoginWall(r.finalUrl, r.html, words)) status = "login_required";
      // JS-only shell or blank page: nothing to read, unless the page publishes its content as metadata / structured data.
      else if (words < 20 && quick.metaWordCount < 15) status = "empty";
      else if (words < 20) s = log(s, "fetch_page", "metadata_only", { url: target, metaWords: quick.metaWordCount });
    }
    const page: PageRecord = {
      url: canonical, pageType, hitNumber, fetchStatus: status, httpStatus: r.httpStatus, selectionReason: reason,
      targetField, title: "", wordCount: words, attempts: r.attempts, fetchedAt: deps.now().toISOString(),
    };
    s = { ...s, pages: [...s.pages, page], retryCounts: { ...s.retryCounts, [canonical]: Math.max(0, r.attempts - 1) } };
    s = log(s, "fetch_page", "fetch_finished", { url: canonical, status, httpStatus: r.httpStatus, attempts: r.attempts, error: r.error });

    if (status === "ok" && r.html) {
      if (isHome) {
        const finalHost = new URL(r.finalUrl).hostname.replace(/^www\./, "");
        if (!isSameSite(finalHost, s.siteHost)) s = log({ ...s, siteHost: finalHost }, "fetch_page", "homepage_redirected", { from: s.siteHost, to: finalHost });
      }
      pending = { url: canonical, finalUrl: r.finalUrl, pageType, html: r.html };
      return { research: s, next: "clean_content" };
    }

    if (isHome) {
      const messages: Partial<Record<FetchStatus, string>> = {
        captcha: "Homepage is protected by a CAPTCHA / bot challenge. Stopped: we never bypass protections.",
        login_required: "Homepage requires a login. Stopped: we never access authenticated pages.",
        blocked: "The website refused automated access (HTTP 403). Stopped; research this one manually.",
        dns_error: "Domain does not resolve (DNS lookup failed). Check the domain is spelled correctly.",
        ssrf_blocked: "Domain points to a private or unsafe address, or redirected unsafely. Blocked.",
        not_found: "Homepage returned 404 (not found).",
        empty: "Homepage has no readable text (blank page or JavaScript-only site).",
        non_html: "Homepage is not an HTML page.",
        too_large: "Homepage exceeded the maximum page size.",
        timeout: "Homepage timed out after 3 retries.",
        network_error: "Could not connect to the website after 3 retries.",
      };
      const message = messages[status] ?? `Homepage could not be fetched (${status}${r.error ? `: ${r.error}` : ""}).`;
      return { research: { ...s, stopReason: message, qualification: "incomplete", errors: [...s.errors, message], status: "escalated" }, next: "complete_or_escalate" };
    }
    if (status === "captcha") {
      return { research: { ...s, stopReason: `Bot challenge on ${canonical}: stopped fetching to respect the site's protection.` }, next: "qualify_company" };
    }
    return { research: s, next: "validate_required_fields" };
  });

  // 3. clean_content
  const cleanContent = node(async (s0) => {
    let s = stage(s0, "content_cleaning");
    const p = pending!;
    pending = null;
    const c = extractMainContent(p.html, 6000);
    if (p.pageType === "homepage" && !s.companyName) s = { ...s, companyName: companyNameFrom(c.siteName, c.title, s.domain) };
    if (p.pageType === "homepage") {
      const origin = new URL(p.finalUrl).origin;
      const links = discoverLinks(p.html, p.finalUrl, s.siteHost);
      // Sitemap = known same-domain URLs (metadata, not a page hit). Used instead of guessing paths.
      await robotsFor(origin);
      const sitemapUrls = await fetchSitemapUrls(origin, robotsRaw.get(origin) ?? null, deps.fetchDeps);
      const fromSitemap = sitemapCandidates(sitemapUrls, s.siteHost, links);
      const known = [...links, ...fromSitemap];
      // With a sitemap, a page type it doesn't list most likely doesn't exist: don't burn hits guessing.
      // Exception: /security. Certification is the disqualifying gate and sitemaps often omit trust pages,
      // so one guessed /security check is always worth it.
      const guessed = sitemapUrls.length ? guessedCandidates(origin, known).filter((g) => g.url === `${origin}/security`) : guessedCandidates(origin, known);
      const candidates = [...known, ...guessed].filter((x) => !s.visitedUrls.includes(x.url));
      s = log({ ...s, candidateLinks: candidates }, "clean_content", "links_discovered", { fromHomepage: links.length, fromSitemap: fromSitemap.length, candidates: candidates.map((x) => `${x.pageType}: ${x.url} (${x.source})`).slice(0, 20) });
    }
    s = { ...s, pages: s.pages.map((pg) => (pg.url === p.url ? { ...pg, title: c.title, wordCount: c.wordCount } : pg)) };
    s = log(s, "clean_content", "cleaned", { url: p.url, words: c.wordCount, charsKept: c.text.length, footerSignals: c.footerSignals });
    cleaned = { url: p.url, pageType: p.pageType, title: c.title, text: c.text, shortLines: c.shortLines };
    return { research: s, next: "extract_facts" };
  });

  // 4. extract_facts (+ evidence validation + people named on the page)
  const extractFacts = node((s0) => {
    let s = stage(s0, "structured_extraction");
    const c = cleaned!;
    cleaned = null;
    const facts = extractPageFacts({ content: c.text, pageType: c.pageType, shortLines: c.shortLines });
    s = stage(s, "evidence_validation");
    // Quotes are verified against everything this page actually contained.
    const verifiable = `${c.text}\n${c.shortLines.join("\n")}`;
    const outcome = extractCompanyFacts(s, facts, { url: c.url, title: c.title, pageType: c.pageType, content: verifiable }, deps.now());
    s = { ...s, ...outcome.patch };
    if (s.contact?.source !== "manual") {
      const keys = [s.domain.split(".")[0], (s.companyName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")];
      const people = extractPeople([...c.shortLines, ...c.text.split("\n")], c.url, keys);
      const known = s.contactCandidates.map((m) => ({ name: m.name, title: m.title ?? "", quote: m.supportingQuote ?? "", sourceUrl: m.sourceUrl ?? c.url }));
      const ranked = rankPeople([...known, ...people.filter((p) => !known.some((k) => k.name === p.name))]);
      if (ranked.length) s = { ...s, contactCandidates: ranked.slice(0, 8), contact: ranked[0], contactStatus: "found" };
    }
    s = log(s, "extract_facts", "evidence_validated", {
      url: c.url,
      accepted: outcome.accepted.map((e) => `${e.field}: ${e.value}`),
      rejected: outcome.rejected.length,
      people: s.contactCandidates.map((p) => `${p.name} (${p.title})`).slice(0, 5),
    });
    return { research: s, next: "validate_required_fields" };
  });

  // 5. validate_required_fields
  const validateFields = node((s0) => {
    let s = stage(s0, "evidence_validation");
    const short = isShortCircuited(s);
    if (short) return { research: log({ ...s, stopReason: short, missingFields: [] }, "validate_required_fields", "short_circuit", { reason: short }), next: "qualify_company" };
    // Certification asked as far as it is worth (1 page) -> not_found, uncertainty preserved.
    if (s.certificationStatus === "unknown") {
      const tried = (s.fieldAttempts["certification_status"] ?? 0) >= fieldLimit(s, "certification_status");
      const noCandidate = !s.candidateLinks.some((c) => c.pageType === "security" && !s.visitedUrls.includes(c.url));
      if (s.pages.some((p) => p.pageType === "homepage" && p.fetchStatus === "ok") && (tried || noCandidate)) s = { ...s, certificationStatus: "not_found" };
    }
    const missing = missingRequiredFields(s);
    s = { ...s, missingFields: missing };
    let decision: string;
    if (s.stopReason) decision = "qualify_company";
    else if (s.hitCount >= MAX_HITS) {
      s = { ...s, stopReason: missing.length ? `Five-hit budget exhausted. Still missing: ${missing.join(", ")}.` : "Five-hit budget used." };
      decision = "qualify_company";
    } else if (s.loopIterations >= MAX_LOOP_ITERATIONS) {
      s = { ...s, stopReason: "Loop iteration cap reached." };
      decision = "qualify_company";
    } else if (missing.length === 0 && !needsContact(s)) {
      s = { ...s, stopReason: "All required facts established." };
      decision = "qualify_company";
    } else decision = "select_next_source";
    return { research: log(s, "validate_required_fields", "checked", { missing, hits: `${s.hitCount}/${MAX_HITS}`, decision }), next: decision };
  });

  // 6. select_next_source
  const selectSource = node((s0) => {
    let s = stage({ ...s0, loopIterations: s0.loopIterations + 1 }, "adaptive_research");
    const sel = selectNextSource(s);
    if (!sel) {
      s = {
        ...s,
        certificationStatus: s.certificationStatus === "unknown" && s.pages.some((p) => p.fetchStatus === "ok") ? "not_found" : s.certificationStatus,
        stopReason: s.missingFields.length ? `No remaining relevant page for: ${s.missingFields.join(", ")}.` : "All required facts established (no team page available for a contact).",
        nextResearchTarget: null, nextResearchReason: null, nextResearchField: null,
      };
      return { research: log(s, "select_next_source", "no_source", { missing: s.missingFields }), next: "qualify_company" };
    }
    s = { ...s, nextResearchTarget: sel.url, nextResearchReason: sel.reason, nextResearchField: sel.missingField };
    return { research: log(s, "select_next_source", "selected", { url: sel.url, pageType: sel.pageType, missingField: sel.missingField, reason: sel.reason }), next: "fetch_page" };
  });

  // 7. qualify_company
  const qualify = node((s0) => {
    let s = stage(s0, "icp_qualification");
    const result = qualifyCompany(s);
    s = { ...s, qualification: result.qualification, qualificationReasons: result.reasons, certificationStatus: result.certificationStatus, missingFields: missingRequiredFields(s), nextResearchTarget: null };
    if (result.qualification === "incomplete" && !s.stopReason) s = { ...s, stopReason: result.summary };
    s = log(s, "qualify_company", "decided", { qualification: result.qualification, summary: result.summary });
    return { research: s, next: outreachEligible(s) ? "discover_contact" : "save_results" };
  });

  // 8. discover_contact
  const discoverContact = node((s0) => {
    let s = stage(s0, "contact_discovery");
    const c = s.contact;
    if (c) {
      s = { ...s, contactStatus: c.source === "manual" ? "manual" : "found" };
      return { research: log(s, "discover_contact", "contact_selected", { selected: `${c.name} (${c.title ?? "title unknown"})`, reason: c.selectionReason }), next: "identify_pain_points" };
    }
    s = { ...s, contactStatus: "none_found", errors: [...s.errors, "No named decision-maker found on the public pages fetched. You can provide one as: domain | Name | Title"] };
    return { research: log(s, "discover_contact", "no_contact_found"), next: "identify_pain_points" };
  });

  // 9. identify_pain_points
  const painPoints = node((s0) => {
    let s = stage(s0, "pain_point_analysis");
    painResult = identifyPainPoints(s);
    s = { ...s, painPoints: painResult.painPoints };
    return { research: log(s, "identify_pain_points", "generated", { painPoints: s.painPoints.map((p) => p.problem) }), next: "generate_email" };
  });

  // 10. generate_email
  const genEmail = node((s0) => {
    let s = stage(s0, "email_drafting");
    const pr = painResult ?? identifyPainPoints(s);
    const draft = generateEmail(s, pr.kinds, pr.hooks);
    const problems = validateEmailDraft(draft, { firstName: s.contact?.name.split(/\s+/)[0] ?? null, evidence: s.evidence });
    s = { ...s, emailSubject: draft.subject, emailBody: draft.body, emailStatus: "draft", emailError: problems.length ? `Quality checks not passed: ${problems.join("; ")}` : null };
    return { research: log(s, "generate_email", problems.length ? "draft_flagged" : "draft_ready", { subject: draft.subject, hook: draft.hook_quote, hookSource: draft.hook_source_url, rationale: draft.rationale, problems }), next: "save_results" };
  });

  // 11. save_results (+ Gmail delivery to your own inbox)
  const saveResults = node(async (s0) => {
    let s = s0;
    if (s.emailSubject && s.emailBody) {
      s = stage(s, "gmail_delivery");
      if (!deps.mailer || !deps.selfEmail) {
        s = { ...s, emailStatus: "not_configured", emailError: s.emailError ?? "Email is not configured on the server; the draft is shown here." };
      } else if (s.emailError) {
        s = log(s, "save_results", "auto_send_skipped", { reason: s.emailError });
      } else if (deps.autoSend) {
        deps.onUpdate?.(s);
        const result = await deliverToSelf(deps.mailer, deps.selfEmail, buildSelfEmail(s), s.id);
        s = { ...s, emailStatus: result.status, emailMessageId: result.messageId, emailError: result.error };
        s = log(s, "save_results", result.status === "sent" ? "email_sent_to_self" : "email_send_failed", { error: result.error, provider: deps.mailer.provider });
      }
    }
    return { research: s, next: "complete_or_escalate" };
  });

  // 12. complete_or_escalate
  const complete = node((s0) => {
    const status = s0.status === "escalated" ? "escalated" : "completed";
    const s: ResearchState = { ...s0, status, stage: status, completedAt: deps.now().toISOString() };
    return { research: log(s, "complete_or_escalate", status, { qualification: s.qualification, stopReason: s.stopReason, hits: `${s.hitCount}/${MAX_HITS}` }), next: END };
  });

  const route = (gs: GS) => gs.next;
  return new StateGraph(GraphState)
    .addNode("initialize_research", initialize)
    .addNode("fetch_page", fetchPageNode)
    .addNode("clean_content", cleanContent)
    .addNode("extract_facts", extractFacts)
    .addNode("validate_required_fields", validateFields)
    .addNode("select_next_source", selectSource)
    .addNode("qualify_company", qualify)
    .addNode("discover_contact", discoverContact)
    .addNode("identify_pain_points", painPoints)
    .addNode("generate_email", genEmail)
    .addNode("save_results", saveResults)
    .addNode("complete_or_escalate", complete)
    .addEdge(START, "initialize_research")
    .addConditionalEdges("initialize_research", route, ["fetch_page"])
    .addConditionalEdges("fetch_page", route, ["clean_content", "validate_required_fields", "qualify_company", "complete_or_escalate"])
    .addConditionalEdges("clean_content", route, ["extract_facts"])
    .addConditionalEdges("extract_facts", route, ["validate_required_fields"])
    .addConditionalEdges("validate_required_fields", route, ["qualify_company", "select_next_source"])
    .addConditionalEdges("select_next_source", route, ["fetch_page", "qualify_company"])
    .addConditionalEdges("qualify_company", route, ["discover_contact", "save_results"])
    .addConditionalEdges("discover_contact", route, ["identify_pain_points"])
    .addConditionalEdges("identify_pain_points", route, ["generate_email"])
    .addConditionalEdges("generate_email", route, ["save_results"])
    .addConditionalEdges("save_results", route, ["complete_or_escalate"])
    .addEdge("complete_or_escalate", END)
    .compile();
}

/** Research one company end to end. Never throws: unexpected errors produce an escalated result. */
export async function runCompanyResearch(state: ResearchState, deps: AgentDeps): Promise<ResearchState> {
  let latest = state;
  const graph = buildResearchGraph({ ...deps, onUpdate: (s) => { latest = s; deps.onUpdate?.(s); } });
  try {
    const out = await graph.invoke({ research: state, next: "" }, { recursionLimit: 80 });
    return out.research as ResearchState;
  } catch (err) {
    const message = `Unexpected error: ${(err as Error).message}`;
    const failed: ResearchState = {
      ...latest, status: "escalated", stage: "escalated", qualification: latest.qualification === "pending" ? "incomplete" : latest.qualification,
      errors: [...latest.errors, message], stopReason: latest.stopReason ?? message, completedAt: deps.now().toISOString(),
    };
    deps.onUpdate?.(failed);
    return failed;
  }
}

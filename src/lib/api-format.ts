// Request/response formats for the public API, built to be lenient for automated test scripts.
import type { ResearchState } from "@/lib/types";

type Json = unknown;

const DOMAIN_KEYS = ["domain", "domains", "url", "urls", "website", "websites", "company_domain", "companyDomain", "company_url", "companies", "company", "input", "inputs", "prospects", "targets", "list", "data"];
const NAME_KEYS = ["contact_name", "contactName", "poc_name", "pocName", "poc", "name", "contact", "person", "full_name", "fullName"];
const TITLE_KEYS = ["contact_title", "contactTitle", "poc_title", "pocTitle", "title", "role", "designation", "position", "job_title", "jobTitle"];

const pick = (o: Record<string, Json>, keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};

/** One object → one input line ("acme.com" or "acme.com | Jane Doe | CTO"). */
function objectToLine(o: Record<string, Json>): string | null {
  const domain = pick(o, ["domain", "url", "website", "company_domain", "companyDomain", "company_url", "companyUrl", "site"]);
  if (typeof domain !== "string") return null;
  const rawName = pick(o, NAME_KEYS);
  const name = typeof rawName === "string" ? rawName : rawName && typeof rawName === "object" ? (pick(rawName as Record<string, Json>, ["name", "full_name", "fullName"]) as string | undefined) : undefined;
  const titleRaw = pick(o, TITLE_KEYS) ?? (rawName && typeof rawName === "object" ? pick(rawName as Record<string, Json>, TITLE_KEYS) : undefined);
  const title = typeof titleRaw === "string" ? titleRaw : "";
  return name && typeof name === "string" && name.trim() ? `${domain} | ${name.trim()} | ${title.trim()}` : domain;
}

/**
 * Turn almost any reasonable request body into input lines. Accepts:
 *   "a.com\nb.io" · ["a.com", "b.io"] · {domains: ...} · {domain: "a.com"} · {urls|websites|companies|input: ...}
 *   [{domain, contact_name, contact_title}] · {companies: [{url, poc: {name, title}}]}
 * Returns null when nothing usable is found.
 */
export function normalizeResearchRequest(body: Json, depth = 0): string[] | null {
  if (depth > 4 || body === null || body === undefined) return null;
  if (typeof body === "string") return body.trim() ? [body] : [];
  if (Array.isArray(body)) {
    const lines: string[] = [];
    for (const item of body.slice(0, 200)) {
      if (typeof item === "string") lines.push(item);
      else if (item && typeof item === "object") {
        const line = objectToLine(item as Record<string, Json>);
        if (line) lines.push(line);
      }
    }
    return body.length === 0 ? [] : lines.length ? lines : null;
  }
  if (typeof body === "object") {
    const o = body as Record<string, Json>;
    const single = objectToLine(o);
    if (single && typeof (o.domain ?? o.url ?? o.website) === "string") return [single];
    for (const k of DOMAIN_KEYS) {
      if (o[k] === undefined) continue;
      const nested = normalizeResearchRequest(o[k], depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/** Compact, stable per-company result for API consumers. */
export function summarize(s: ResearchState) {
  const durationMs = s.startedAt && s.completedAt ? new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime() : null;
  return {
    domain: s.domain,
    company_name: s.companyName,
    status: s.status, // completed | escalated
    qualification: s.qualification, // qualified | disqualified | manual_review | incomplete
    qualified: s.qualification === "qualified",
    summary: s.qualificationReasons.map((r) => `${r.gate}: ${r.result}`).join(", ") || s.stopReason,
    reasons: s.qualificationReasons.map((r) => ({
      gate: r.gate,
      result: r.result,
      explanation: r.explanation,
      evidence: r.evidence.map((e) => ({ quote: e.supportingQuote, source_url: e.sourceUrl })),
    })),
    certification: { status: s.certificationStatus, named: s.namedCertifications },
    is_saas: s.isSaas,
    is_b2b: s.isB2B,
    funding_stage: s.fundingStage,
    open_roles: s.openRoleCount,
    contact: s.contact ? { name: s.contact.name, title: s.contact.title, source: s.contact.source, source_url: s.contact.sourceUrl, why: s.contact.selectionReason } : null,
    pain_points: s.painPoints.map((p) => ({ hypothesis: p.problem, evidence: p.evidence, source_urls: p.evidenceUrls, why_it_matters: p.roleRelevance, confidence: p.confidence, angle: p.outreachAngle })),
    email: s.emailBody
      ? { to: "configured user's own inbox", addressed_to: s.contact?.name ?? `${s.companyName ?? s.domain} team`, subject: s.emailSubject, body: s.emailBody, status: s.emailStatus, sent: s.emailStatus === "sent", error: s.emailError }
      : null,
    pages_fetched: s.pages.map((p) => ({ hit: p.hitNumber, url: p.url, type: p.pageType, status: p.fetchStatus, why: p.selectionReason })),
    page_hits: s.hitCount,
    evidence: s.evidence.map((e) => ({ field: e.field, value: e.value, quote: e.supportingQuote, source_url: e.sourceUrl })),
    stop_reason: s.stopReason,
    errors: s.errors,
    duration_ms: durationMs,
  };
}

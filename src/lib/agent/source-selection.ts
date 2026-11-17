// select_next_source: choose the single most useful same-domain page for the first missing fact.
// Deterministic by design so every fetch decision is reproducible and explainable.
import { MAX_HITS, type CandidateLink, type PageType, type ResearchState } from "@/lib/types";
import { missingRequiredFields, type RequiredField } from "@/lib/qualify/gates";
import { isVisited } from "./hit-budget";

export type ResearchField = RequiredField | "contact";

/** Ordered page types that can resolve each missing field, with why. */
export const FIELD_SOURCES: Record<ResearchField, Array<{ type: PageType; why: string }>> = {
  certification_status: [{ type: "security", why: "security/trust pages are where companies name SOC 2 / ISO 27001 certifications" }],
  b2b_saas: [
    { type: "product", why: "product pages describe what the software does and who buys it" },
    { type: "about", why: "about pages describe the business model and customer type" },
    { type: "pricing", why: "pricing pages show per-seat / per-team business plans" },
    { type: "customers", why: "customer pages show whether buyers are businesses" },
  ],
  stage: [
    { type: "careers", why: "careers pages list open roles (5+ is a growth signal) and often mention funding" },
    { type: "pricing", why: "pricing pages show whether an enterprise tier exists" },
    { type: "customers", why: "customer pages show enterprise customers and scale" },
    { type: "about", why: "about pages often name investors and funding rounds" },
  ],
  contact: [
    { type: "team", why: "team/leadership pages list decision-makers by name and title" },
    { type: "about", why: "about / press pages usually name the founders and leadership" },
  ],
};

/** Max page fetches each question is worth (evidence map), within the global five-hit cap. */
// Stage is worth 2 fetches (L4 evidence map); this also keeps a hit free for the team page.
export const FIELD_FETCH_LIMIT: Record<ResearchField, number> = { certification_status: 1, b2b_saas: 1, stage: 2, contact: 2 };

const FIELD_LABEL: Record<ResearchField, string> = {
  certification_status: "Certification status unknown",
  b2b_saas: "B2B SaaS not yet confirmed",
  stage: "Stage evidence missing (no Series A–C round, 5+ open roles or enterprise tier yet)",
  contact: "Company qualifies but no named decision-maker found yet",
};

const SOURCE_RANK: Record<CandidateLink["source"], number> = { homepage_link: 0, sitemap: 1, guessed_path: 2 };

export interface SourceSelection {
  url: string;
  pageType: PageType;
  missingField: ResearchField;
  reason: string;
  candidate: CandidateLink;
}

/** A team page is worth a hit once the company is confirmed B2B SaaS, not certified, and nobody is named yet. */
export function needsContact(state: ResearchState): boolean {
  // A person seen only on the homepage may be a testimonial: still worth one look at a team/about page.
  const onlyHomepage = !!state.contact && state.contact.source === "website" && state.pages.some((p) => p.pageType === "homepage" && p.url === state.contact!.sourceUrl);
  const readPeoplePage = state.pages.some((p) => (p.pageType === "team" || p.pageType === "about") && p.fetchStatus === "ok");
  const wanted = !state.contact || (onlyHomepage && !readPeoplePage);
  return wanted && state.isSaas === true && state.isB2B === true && state.namedCertifications.length === 0 && (state.fieldAttempts["contact"] ?? 0) < FIELD_FETCH_LIMIT.contact;
}

/**
 * Fetch budget for a field. Certification gets a second try only when the first security page
 * had no readable content (JavaScript-only, 404, blocked): an unread page proves nothing.
 */
export function fieldLimit(state: ResearchState, field: ResearchField): number {
  if (field !== "certification_status") return FIELD_FETCH_LIMIT[field];
  const read = state.pages.some((p) => p.pageType === "security" && p.fetchStatus === "ok");
  const failed = state.pages.some((p) => p.pageType === "security" && p.fetchStatus !== "ok");
  return !read && failed ? 2 : 1;
}

/** Missing ICP fields that still have fetch budget left. */
function openFields(state: ResearchState): RequiredField[] {
  return missingRequiredFields(state).filter((f) => (state.fieldAttempts[f] ?? 0) < fieldLimit(state, f));
}

export function selectNextSource(state: ResearchState): SourceSelection | null {
  if (state.hitCount >= MAX_HITS) return null;
  if (state.qualification === "disqualified") return null;
  // ICP facts first; then (budget permitting) a team page for a named contact.
  const open = openFields(state);
  const contact = needsContact(state) ? (["contact"] as const) : [];
  // With one page left, a named contact (the brief: "addressed to a real person by name") beats a second stage guess.
  const lastHit = MAX_HITS - state.hitCount === 1;
  const stageTried = (state.fieldAttempts["stage"] ?? 0) >= 1;
  const fields: ResearchField[] = lastHit && stageTried && contact.length && !open.some((f) => f !== "stage") ? [...contact, ...open] : [...open, ...contact];
  for (const field of fields) {
    if ((state.fieldAttempts[field] ?? 0) >= fieldLimit(state, field)) continue;
    const secondCertTry = field === "certification_status" && (state.fieldAttempts[field] ?? 0) >= 1;
    const options: Array<{ cand: CandidateLink; type: PageType; why: string; order: number }> = [];
    FIELD_SOURCES[field].forEach(({ type, why }, order) => {
      // Don't fetch a second page of a type we already read successfully.
      if (state.pages.some((p) => p.pageType === type && p.fetchStatus === "ok")) return;
      for (const cand of state.candidateLinks) {
        if (cand.pageType !== type || isVisited(state, cand.url)) continue;
        // A second certification try only uses pages the site actually links or lists, never a guess.
        if (secondCertTry && cand.source === "guessed_path") continue;
        options.push({ cand, type, why, order });
      }
    });
    // Stage/B2B: page-type order matters most. Contact: a page the site links beats a guessed one of a "better" type.
    options.sort((a, b) =>
      field === "contact"
        ? SOURCE_RANK[a.cand.source] - SOURCE_RANK[b.cand.source] || a.order - b.order || b.cand.score - a.cand.score
        : a.order - b.order || SOURCE_RANK[a.cand.source] - SOURCE_RANK[b.cand.source] || b.cand.score - a.cand.score,
    );
    const best = options[0];
    if (!best) continue;
    const pick = best.cand;
    const how = pick.source === "homepage_link" ? `linked from the homepage${pick.anchorText ? ` ("${pick.anchorText}")` : ""}` : pick.source === "sitemap" ? "listed in the site's sitemap" : "conventional path (not linked from the homepage or sitemap)";
    return {
      url: pick.url,
      pageType: best.type,
      missingField: field,
      candidate: pick,
      reason: `${FIELD_LABEL[field]}. Chose the ${best.type} page, ${how}: ${best.why}. Hit ${state.hitCount + 1}/${MAX_HITS}.`,
    };
  }
  return null;
}

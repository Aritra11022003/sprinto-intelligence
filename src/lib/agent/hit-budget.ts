// Server-side enforcement of the five-hit rule. The homepage is hit 1; a sixth unique page is
// impossible: reserveHit() throws before any network request is made.
import { MAX_HITS, type ResearchState } from "@/lib/types";
import { canonicalizeUrl } from "@/lib/scraper/links";

export class HitBudgetError extends Error {
  constructor(message: string, readonly code: "exhausted" | "duplicate" | "homepage_first") {
    super(message);
    this.name = "HitBudgetError";
  }
}

export function hitsRemaining(state: Pick<ResearchState, "hitCount">): number {
  return Math.max(0, MAX_HITS - state.hitCount);
}

export function isVisited(state: Pick<ResearchState, "visitedUrls">, url: string): boolean {
  const c = canonicalizeUrl(url) ?? url;
  return state.visitedUrls.includes(c);
}

/**
 * Reserve one unique-page hit for `url`. Returns the updated counters; never mutates input.
 * Throws HitBudgetError if the URL was already fetched, the budget is exhausted, or the
 * first hit is not the homepage.
 */
export function reserveHit(
  state: Pick<ResearchState, "hitCount" | "visitedUrls">,
  url: string,
  isHomepage: boolean,
): { hitNumber: number; hitCount: number; visitedUrls: string[]; canonicalUrl: string } {
  const canonicalUrl = canonicalizeUrl(url) ?? url;
  if (state.visitedUrls.includes(canonicalUrl)) {
    throw new HitBudgetError(`Already fetched ${canonicalUrl}; duplicate fetches are not allowed`, "duplicate");
  }
  if (state.hitCount >= MAX_HITS) {
    throw new HitBudgetError(`Five-hit budget exhausted; refusing to fetch ${canonicalUrl}`, "exhausted");
  }
  if (state.hitCount === 0 && !isHomepage) {
    throw new HitBudgetError("Hit 1 must be the homepage", "homepage_first");
  }
  const hitNumber = state.hitCount + 1;
  return { hitNumber, hitCount: hitNumber, visitedUrls: [...state.visitedUrls, canonicalUrl], canonicalUrl };
}

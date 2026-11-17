// Discover candidate research URLs from the homepage's own (public) navigation.
// We never crawl: candidates come from homepage links, plus a few conventional paths as fallback.
import * as cheerio from "cheerio";
import { isSameSite } from "@/lib/security/domain";
import type { CandidateLink, PageType } from "@/lib/types";
import { classifyPage } from "./classify";

/** Public job boards a company links to from its own site are treated as its careers page. */
const ATS_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|recruitee\.com|breezy\.hr|smartrecruiters\.com|bamboohr\.com|teamtailor\.com|personio\.(de|com)|wellfound\.com)$/i;

export const GUESSED_PATHS: Record<Exclude<PageType, "homepage" | "other">, string[]> = {
  security: ["/security", "/trust"],
  careers: ["/careers", "/jobs"],
  pricing: ["/pricing"],
  customers: ["/customers"],
  about: ["/about"],
  team: ["/team"],
  product: ["/product"],
};

const SKIP_PATH = /\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|mov|xml|json|css|js)$|\/(blog|news|events?|webinars?|docs?|help|support|legal|legal-[a-z-]+|terms(-[a-z-]+)?|tos|privacy(-[a-z-]+)?|cookies?(-[a-z-]+)?|dpa|subprocessors|acceptable-use|imprint|disclaimer|login|log-in|signin|sign-in|signup|sign-up|register|demo|contact|status|cdn-cgi|wp-admin|feed|tag|category|author)(\/|$)/i;

export function canonicalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|ref$|hs)/i.test(key)) u.searchParams.delete(key);
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (u.pathname !== "/" && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export function discoverLinks(html: string, baseUrl: string, siteDomain: string): CandidateLink[] {
  const $ = cheerio.load(html);
  const byUrl = new Map<string, CandidateLink>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const url = canonicalizeUrl(abs);
    if (!url) return;
    const u = new URL(url);
    const anchor = $(el).text().replace(/\s+/g, " ").trim().slice(0, 80);
    const sameSite = isSameSite(u.hostname, siteDomain);
    const isAts = ATS_HOSTS.test(u.hostname);
    if (!sameSite && !isAts) return;
    if (SKIP_PATH.test(u.pathname)) return;
    if (u.pathname.split("/").filter(Boolean).length > 3) return; // deep pages (blog posts etc.) are not research targets
    let pageType = isAts ? "careers" : classifyPage(url, anchor);
    if (pageType === "other" || pageType === "homepage") return;
    // Docs/app/blog subdomains are not company-overview pages.
    if (sameSite && /^(app|docs|help|support|status|blog|community|dashboard|portal|api)\./.test(u.hostname)) {
      if (!(pageType === "security" && /^trust\.|^security\./.test(u.hostname))) return;
    }
    if (/^(trust|security)\./.test(u.hostname)) pageType = "security";
    const depth = u.pathname.split("/").filter(Boolean).length;
    const score = 100 - depth * 10 + (anchor ? 5 : 0) + (u.search ? -15 : 0);
    const existing = byUrl.get(url);
    if (!existing || existing.score < score) {
      byUrl.set(url, { url, pageType: pageType as PageType, anchorText: anchor, source: "homepage_link", score });
    }
  });
  return [...byUrl.values()].sort((a, b) => b.score - a.score);
}

/** Conventional same-domain paths, used only when the homepage links nothing for that page type. */
export function guessedCandidates(origin: string, existing: CandidateLink[]): CandidateLink[] {
  const have = new Set(existing.map((c) => c.pageType));
  const out: CandidateLink[] = [];
  for (const [type, paths] of Object.entries(GUESSED_PATHS)) {
    if (have.has(type as PageType)) continue;
    paths.forEach((p, i) => {
      out.push({ url: `${origin}${p}`, pageType: type as PageType, anchorText: "", source: "guessed_path", score: 40 - i * 5 });
    });
  }
  return out;
}

/** Parse <loc> URLs from a sitemap (or sitemap index). */
export function parseSitemap(xml: string): { urls: string[]; childSitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&")).slice(0, 5000);
  const isIndex = /<sitemapindex/i.test(xml);
  return isIndex ? { urls: [], childSitemaps: locs.slice(0, 50) } : { urls: locs, childSitemaps: [] };
}

/** Research candidates from sitemap URLs: shallow, same-site pages of a research page type. */
export function sitemapCandidates(urls: string[], siteDomain: string, existing: CandidateLink[]): CandidateLink[] {
  const have = new Set(existing.map((c) => c.url));
  const out = new Map<string, CandidateLink>();
  for (const raw of urls) {
    const url = canonicalizeUrl(raw);
    if (!url || have.has(url)) continue;
    const u = new URL(url);
    if (!isSameSite(u.hostname, siteDomain) || SKIP_PATH.test(u.pathname)) continue;
    const depth = u.pathname.split("/").filter(Boolean).length;
    if (depth === 0 || depth > 2) continue;
    // Skip localised duplicates like /de/pricing when /pricing exists.
    if (/^\/[a-z]{2}(-[a-z]{2})?\//i.test(u.pathname) && depth > 1) continue;
    const pageType = classifyPage(url);
    if (pageType === "other" || pageType === "homepage") continue;
    // Only section roots ("/trust", "/company/careers"), never sub-pages ("/trust/slavery-statement", "/careers/a-job").
    if (classifyPage(`${u.origin}/${u.pathname.split("/").filter(Boolean).pop()}`) !== pageType) continue;
    if (!out.has(url)) out.set(url, { url, pageType, anchorText: "", source: "sitemap", score: 80 - depth * 10 });
  }
  return [...out.values()];
}

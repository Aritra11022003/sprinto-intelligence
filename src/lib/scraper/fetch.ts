// fetchPage(): one public, SSRF-safe HTTP fetch with bounded retries.
// Retries never count as extra unique-page hits; the hit budget lives in agent/hit-budget.ts.
import { assertPublicUrl, defaultResolver, DnsError, UnsafeUrlError, type HostResolver } from "@/lib/security/ssrf";
import { isSameSite } from "@/lib/security/domain";
import { MAX_FETCH_RETRIES, type FetchStatus } from "@/lib/types";
import { BOT_TOKEN } from "./robots";
import { detectCaptcha } from "./barriers";

export const USER_AGENT = `Mozilla/5.0 (compatible; ${BOT_TOKEN}/1.0; prospect research for B2B outreach)`;

export interface FetchDeps {
  fetchImpl: typeof fetch;
  resolve: HostResolver;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  maxBytes: number;
  maxRetries: number;
}

export const defaultFetchDeps: FetchDeps = {
  fetchImpl: (...args) => fetch(...args),
  resolve: defaultResolver,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs: 10_000,
  maxBytes: 2_000_000,
  maxRetries: MAX_FETCH_RETRIES,
};

export interface FetchResult {
  status: FetchStatus;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  html: string | null;
  contentType: string | null;
  attempts: number;
  transient: boolean;
  error: string | null;
}

export interface FetchOptions {
  /** Company domain. Redirects must stay on this site unless allowCrossSiteRedirect is set. */
  siteDomain: string;
  /** The homepage may legitimately redirect to a new brand domain (e.g. acme.io -> acme.com). */
  allowCrossSiteRedirect?: boolean;
}

const MAX_REDIRECTS = 5;

class TransientError extends Error {}

async function readLimited(res: Response, maxBytes: number): Promise<string | "TOO_LARGE"> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared && declared > maxBytes) return "TOO_LARGE";
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return "TOO_LARGE";
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

function result(partial: Partial<FetchResult> & Pick<FetchResult, "status" | "requestedUrl">): FetchResult {
  return {
    finalUrl: partial.requestedUrl,
    httpStatus: null,
    html: null,
    contentType: null,
    attempts: 1,
    transient: false,
    error: null,
    ...partial,
  };
}

/** One attempt, following redirects manually so each hop is re-validated against SSRF rules. */
async function attemptOnce(url: string, deps: FetchDeps, opts: FetchOptions): Promise<FetchResult> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = await assertPublicUrl(current, deps.resolve);
    if (hop > 0 && !opts.allowCrossSiteRedirect && !isSameSite(parsed.hostname, opts.siteDomain)) {
      return result({ status: "ssrf_blocked", requestedUrl: url, finalUrl: current, error: `Redirected off-site to ${parsed.hostname}` });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    let res: Response;
    try {
      res = await deps.fetchImpl(parsed.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") throw new TransientError("timeout");
      throw new TransientError(`network: ${(err as Error).message}`);
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, parsed).toString();
      continue;
    }

    const contentType = res.headers.get("content-type");
    if (res.status === 404 || res.status === 410) {
      return result({ status: "not_found", requestedUrl: url, finalUrl: current, httpStatus: res.status });
    }
    if (res.status === 401) {
      return result({ status: "login_required", requestedUrl: url, finalUrl: current, httpStatus: res.status });
    }
    if (res.status === 403 || res.status === 451) {
      const body = await readLimited(res, 200_000).catch(() => "");
      const isChallenge = typeof body === "string" && (detectCaptcha(body, 0) || /captcha|are you a robot|verify you are human/i.test(body));
      return result({ status: isChallenge ? "captcha" : "blocked", requestedUrl: url, finalUrl: current, httpStatus: res.status });
    }
    if (res.status === 429 || res.status >= 500) {
      throw Object.assign(new TransientError(`HTTP ${res.status}`), { httpStatus: res.status, finalUrl: current });
    }
    if (res.status >= 400) {
      return result({ status: "http_error", requestedUrl: url, finalUrl: current, httpStatus: res.status, error: `HTTP ${res.status}` });
    }
    if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain|[/+]xml/i.test(contentType)) {
      return result({ status: "non_html", requestedUrl: url, finalUrl: current, httpStatus: res.status, contentType });
    }
    const body = await readLimited(res, deps.maxBytes);
    if (body === "TOO_LARGE") {
      return result({ status: "too_large", requestedUrl: url, finalUrl: current, httpStatus: res.status, contentType });
    }
    if (!body.trim()) {
      return result({ status: "empty", requestedUrl: url, finalUrl: current, httpStatus: res.status, contentType, html: "" });
    }
    return result({ status: "ok", requestedUrl: url, finalUrl: current, httpStatus: res.status, contentType, html: body });
  }
  return result({ status: "http_error", requestedUrl: url, error: "Too many redirects" });
}

/**
 * Fetch one publicly accessible page. Transient failures (timeouts, connection errors, 429, 5xx)
 * are retried up to `maxRetries` times with backoff; permanent failures return immediately.
 */
export async function fetchPage(url: string, opts: FetchOptions, deps: FetchDeps = defaultFetchDeps): Promise<FetchResult> {
  let lastError: TransientError | null = null;
  for (let attempt = 1; attempt <= deps.maxRetries + 1; attempt++) {
    try {
      const r = await attemptOnce(url, deps, opts);
      return { ...r, attempts: attempt };
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        return result({ status: "ssrf_blocked", requestedUrl: url, error: err.message, attempts: attempt });
      }
      if (err instanceof DnsError) {
        return result({ status: "dns_error", requestedUrl: url, error: err.message, attempts: attempt });
      }
      if (!(err instanceof TransientError)) {
        return result({ status: "network_error", requestedUrl: url, error: (err as Error).message, attempts: attempt });
      }
      lastError = err;
      if (attempt <= deps.maxRetries) await deps.sleep(250 * attempt * attempt);
    }
  }
  const msg = lastError?.message ?? "unknown";
  const meta = lastError as unknown as { httpStatus?: number; finalUrl?: string };
  return result({
    status: msg === "timeout" ? "timeout" : meta.httpStatus ? "http_error" : "network_error",
    requestedUrl: url,
    finalUrl: meta.finalUrl ?? url,
    httpStatus: meta.httpStatus ?? null,
    attempts: deps.maxRetries + 1,
    transient: true,
    error: msg,
  });
}

/** Fetch robots.txt (not a page hit: it is access-policy metadata, not company content). */
export async function fetchRobotsTxt(origin: string, deps: FetchDeps = defaultFetchDeps): Promise<string | null> {
  try {
    const host = new URL(origin).hostname;
    const r = await fetchPage(`${origin.replace(/\/$/, "")}/robots.txt`, { siteDomain: host }, { ...deps, maxRetries: 1, maxBytes: 500_000 });
    if (r.status !== "ok" || !r.html) return null;
    // Some sites serve their HTML app shell at /robots.txt; ignore anything that is not robots syntax.
    return /user-agent\s*:/i.test(r.html) ? r.html : null;
  } catch {
    return null;
  }
}

/** Fetch sitemap URLs (metadata, not a page hit): robots.txt Sitemap: entries, else /sitemap.xml. One index level. */
export async function fetchSitemapUrls(origin: string, robotsTxt: string | null, deps: FetchDeps = defaultFetchDeps): Promise<string[]> {
  const host = new URL(origin).hostname;
  const quick = { ...deps, maxRetries: 0, maxBytes: 3_000_000, timeoutMs: Math.min(deps.timeoutMs, 6000) };
  const declared = [...(robotsTxt ?? "").matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]).slice(0, 3);
  const roots = declared.length ? declared : [`${origin}/sitemap.xml`];
  const { parseSitemap } = await import("./links");
  const urls: string[] = [];
  for (const root of roots) {
    try {
      const r = await fetchPage(root, { siteDomain: host.replace(/^www\./, ""), allowCrossSiteRedirect: false }, quick);
      if (r.status !== "ok" || !r.html || !/<(urlset|sitemapindex)/i.test(r.html)) continue;
      const parsed = parseSitemap(r.html);
      urls.push(...parsed.urls);
      // Prefer child sitemaps that look like page/marketing sitemaps.
      const children = parsed.childSitemaps.sort((a, b) => Number(/page|main|static|site/i.test(b)) - Number(/page|main|static|site/i.test(a))).slice(0, 2);
      for (const child of children) {
        const c = await fetchPage(child, { siteDomain: host.replace(/^www\./, ""), allowCrossSiteRedirect: false }, quick);
        if (c.status === "ok" && c.html) urls.push(...parseSitemap(c.html).urls);
      }
    } catch {
      /* sitemap is optional */
    }
    if (urls.length) break;
  }
  return urls;
}

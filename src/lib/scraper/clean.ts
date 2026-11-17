// cleanHtml() / extractMainContent() / deduplicateText(): turn raw HTML into a short,
// signal-dense text the model can read (~1,500 tokens per page), keeping hero, product,
// about, careers, security and pricing content and dropping nav, footer, cookie banners,
// scripts, tracking and repeated blocks.
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

export const CERT_RE =
  /\b(soc\s?-?\s?2|soc\s?-?\s?1|iso\s?\/?\s?(iec\s?)?27001|iso\s?27701|iso\s?27017|iso\s?27018|pci[\s-]?dss|fedramp|hitrust|csa\s?star|cyber\s?essentials|tisax)\b/i;

const KEYWORD_RE =
  /(soc\s?2|iso\s?27001|gdpr|hipaa|pci|complian|certif|audit|security|trust|privacy|enterprise|pricing|per (user|seat|month)|\/mo\b|custom pricing|contact sales|series [a-e]\b|seed|funding|raised|backed by|investors|customers|trusted by|b2b|teams|platform|software|saas|api\b|hiring|open (roles|positions)|we're hiring|join (us|our team)|engineer|manager|director|head of|vp\b|lead\b|careers|jobs)/i;

const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "iframe", "template", "canvas", "video", "audio", "object", "embed", "form", "select", "option", "button", "input", "textarea", "picture", "source", "link", "meta"]);
const BLOCK_TAGS = new Set(["address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", "br"]);
const BLOCK_SELECTOR = [...BLOCK_TAGS].join(",");

const NOISE_CLASS_RE = /(^|[\s_-])(nav|navbar|navigation|menu|megamenu|footer|breadcrumbs?|sidebar|modal|popup|newsletter|subscribe|social|share|skip-link|sr-only|visually-hidden|banner-close)([\s_-]|$)/i;
const CONSENT_RE = /(cookie|consent|onetrust|ot-sdk|truste|osano|cookiebot|cmp-|usercentrics|termly|iubenda|klaro)/i;

export interface CleanedPage {
  title: string;
  metaDescription: string;
  siteName: string | null;
  text: string;
  wordCount: number;
  blocks: number;
  /** Certification badges / strings found in the footer or image alt text (removed from main text). */
  footerSignals: string[];
  /** Names/descriptions from the page's own JSON-LD structured data (often the only text on JS-rendered pages). */
  structuredData: string[];
  /** Words available from title, meta description and structured data (used when the body is empty). */
  metaWordCount: number;
  /** Heuristic: the HTML looks like a JavaScript app shell with little server-rendered text. */
  looksJsRendered: boolean;
  /** Short blocks (names, job titles) in page order, kept for people / open-role extraction. */
  shortLines: string[];
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Remove exact and near-exact duplicate blocks (case/punctuation-insensitive). */
export function deduplicateText(blocks: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks) {
    const key = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

interface Block { text: string; tag: string; order: number }

/** Text of a node with a space between child elements (so inline siblings never glue together). */
function textOf($: cheerio.CheerioAPI, node: AnyNode): string {
  const parts: string[] = [];
  const rec = (n: AnyNode) => {
    if (n.type === "text") parts.push((n as unknown as { data: string }).data);
    else if (n.type === "tag") {
      const name = (n as Element).name.toLowerCase();
      if (SKIP_TAGS.has(name)) return;
      for (const c of (n as Element).children ?? []) rec(c);
      parts.push(" ");
    }
  };
  rec(node);
  return normalizeWhitespace(parts.join("")).replace(/\s+([,.;:!?)])/g, "$1");
}

function collectBlocks($: cheerio.CheerioAPI, root: AnyNode): Block[] {
  const out: Block[] = [];
  let order = 0;
  const walk = (node: AnyNode) => {
    let buffer = "";
    const flush = (tag: string) => {
      const t = normalizeWhitespace(buffer);
      if (t) out.push({ text: t, tag, order: order++ });
      buffer = "";
    };
    const children = (node as Element).children ?? [];
    for (const child of children) {
      if (child.type === "text") {
        buffer += ` ${(child as unknown as { data: string }).data}`;
        continue;
      }
      if (child.type !== "tag" && child.type !== "script" && child.type !== "style") continue;
      const el = child as Element;
      const tag = el.name.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      const hasBlockChild = $(el).find(BLOCK_SELECTOR).length > 0;
      if (BLOCK_TAGS.has(tag)) {
        flush("text");
        if (hasBlockChild) walk(el);
        else {
          // <div><span>Jane Doe</span><span>CTO</span></div>: sibling elements with no loose text are separate lines.
          const kids = (el.children ?? []).filter((k) => k.type === "tag" && normalizeWhitespace($(k).text()));
          const looseText = (el.children ?? []).some((k) => k.type === "text" && normalizeWhitespace((k as unknown as { data: string }).data));
          if (!looseText && kids.length >= 2 && kids.length <= 6) {
            for (const k of kids) out.push({ text: textOf($, k), tag, order: order++ });
          } else {
            const t = textOf($, el);
            if (t) out.push({ text: t, tag, order: order++ });
          }
        }
      } else if (hasBlockChild) {
        flush("text");
        walk(el);
      } else {
        // Separate adjacent inline elements so "<span>Jane Doe</span><span>CTO</span>" doesn't glue together.
        buffer += ` ${textOf($, el)} `;
      }
    }
    flush("text");
  };
  walk(root);
  return out;
}

/** Collect human-readable names/descriptions from JSON-LD blocks (the site's own published summary). */
export function extractStructuredData($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  const people: string[] = [];
  const visit = (node: unknown, depth: number, key: string) => {
    if (depth > 6 || out.length >= 20 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1, key));
    const o = node as Record<string, unknown>;
    const type = String(o["@type"] ?? "");
    if (/^(BreadcrumbList|ListItem|ImageObject|SearchAction|EntryPoint|ReadAction)$/.test(type)) return;
    const name = typeof o.name === "string" ? o.name : typeof o.headline === "string" ? o.headline : "";
    // People the site itself publishes: Organization.founder / employee / Person with a job title.
    if (/Person/.test(type) || /^(founder|founders|employee|employees|ceo|member|members)$/i.test(key)) {
      const job = typeof o.jobTitle === "string" ? o.jobTitle : /^founders?$/i.test(key) ? "Founder" : /^ceo$/i.test(key) ? "CEO" : "";
      if (name && job && name.split(" ").length >= 2 && name.length <= 60) people.push(normalizeWhitespace(`${name}, ${job}`));
      return;
    }
    const desc = typeof o.description === "string" ? o.description : "";
    const line = normalizeWhitespace([name, desc].filter(Boolean).join(": "));
    if (line && line.split(" ").length >= 3 && line.length <= 600) out.push(line);
    for (const [k, v] of Object.entries(o)) if (typeof v === "object") visit(v, depth + 1, k);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()), 0, "");
    } catch {
      /* invalid JSON-LD is ignored */
    }
  });
  return [...deduplicateText(people).slice(0, 8), ...deduplicateText(out).slice(0, 12)];
}

/** Remove boilerplate elements in place. Returns certification signals found in removed footers. */
export function cleanHtml($: cheerio.CheerioAPI): { footerSignals: string[] } {
  const footerSignals: string[] = [];
  // Certification badges commonly live in the footer or as images: capture before removal.
  $("img[alt], [aria-label]").each((_, el) => {
    const label = normalizeWhitespace($(el).attr("alt") ?? $(el).attr("aria-label") ?? "");
    if (label && CERT_RE.test(label) && label.length < 160) footerSignals.push(`Badge: ${label}`);
  });
  $("footer, [role=contentinfo]").each((_, el) => {
    const text = normalizeWhitespace($(el).text());
    for (const sentence of text.split(/(?<=[.!?|·•])\s+|\s{2,}/)) {
      if (CERT_RE.test(sentence) && sentence.length < 240) footerSignals.push(`Footer: ${sentence.trim()}`);
    }
  });

  $("script, style, noscript, svg, iframe, template, link, meta, canvas, video, audio, object, embed").remove();
  $("nav, footer, [role=navigation], [role=contentinfo], [role=dialog], [role=alertdialog], [aria-modal=true], [hidden], [aria-hidden=true]").remove();
  // Site headers that are just navigation (keep hero sections that happen to use <header>).
  $("header").each((_, el) => {
    const $el = $(el);
    if ($el.find("h1").length === 0 && ($el.find("a").length > 3 || $el.attr("role") === "banner")) $el.remove();
  });
  $("[id], [class]").each((_, el) => {
    const $el = $(el);
    const sig = `${$el.attr("id") ?? ""} ${$el.attr("class") ?? ""}`;
    if (CONSENT_RE.test(sig) || NOISE_CLASS_RE.test(sig)) {
      // Never drop a block holding the page's main heading.
      if ($el.find("h1").length === 0 && !$el.is("main, article, body, html")) $el.remove();
    }
  });
  // Tracking pixels and hidden elements.
  $("img[width='1'], img[height='1'], [style*='display:none'], [style*='display: none'], [style*='visibility:hidden']").remove();
  return { footerSignals: deduplicateText(footerSignals).slice(0, 12) };
}

/**
 * Pick the blocks that carry company signal and fit them into `maxChars`.
 * Priority: page title + meta description, hero (h1 and what follows), headings,
 * keyword-bearing blocks, then remaining long paragraphs in page order.
 */
export function extractMainContent(html: string, maxChars = 6000): CleanedPage {
  const $ = cheerio.load(html);
  const title = normalizeWhitespace($("title").first().text()).slice(0, 200);
  const metaDescription = normalizeWhitespace($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "").slice(0, 400);
  const siteName = normalizeWhitespace($('meta[property="og:site_name"]').attr("content") ?? "") || null;
  const rawScriptCount = $("script").length;
  const appShell = $("#root, #__next, #app, [data-reactroot], #__nuxt, app-root").length > 0;

  const structuredData = extractStructuredData($);
  const { footerSignals } = cleanHtml($);
  const mainEl = $("main").first();
  const bodyEl = $("body").first();
  const rootNode = (mainEl.length ? mainEl.get(0) : bodyEl.length ? bodyEl.get(0) : $.root().get(0)) as AnyNode;
  let blocks = collectBlocks($, rootNode);
  // If <main> was tiny, fall back to the whole body.
  if (mainEl.length && blocks.reduce((n, b) => n + words(b.text), 0) < 60 && bodyEl.length) {
    blocks = collectBlocks($, $("body").get(0) as AnyNode);
  }

  const kept = blocks.filter((b) => {
    const w = words(b.text);
    if (w < 2) return false;
    if (/^h[1-6]$/.test(b.tag)) return true;
    if (w >= 8) return true;
    return KEYWORD_RE.test(b.text) || CERT_RE.test(b.text);
  });
  const deduped = new Map<string, Block>();
  for (const b of kept) {
    const key = b.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (key && !deduped.has(key)) deduped.set(key, b);
  }
  const unique = [...deduped.values()];
  const totalWords = unique.reduce((n, b) => n + words(b.text), 0);
  const seenShort = new Set<string>();
  const shortLines = blocks
    .filter((b) => words(b.text) <= 12 && b.text.length <= 120)
    .map((b) => b.text)
    .filter((t) => (seenShort.has(t) ? false : (seenShort.add(t), true)))
    .slice(0, 600);

  const firstH1 = unique.find((b) => b.tag === "h1");
  const score = (b: Block) => {
    let s = 0;
    if (firstH1 && b.order >= firstH1.order && b.order <= firstH1.order + 6) s += 50; // hero
    if (/^h[1-3]$/.test(b.tag)) s += 20;
    if (CERT_RE.test(b.text)) s += 40;
    if (KEYWORD_RE.test(b.text)) s += 15;
    s += Math.min(words(b.text), 40) / 4;
    s -= b.order / 50; // mild preference for earlier content
    return s;
  };
  const header = [title && `Title: ${title}`, metaDescription && `Description: ${metaDescription}`].filter(Boolean).join("\n");
  const footer = (footerSignals.length ? `\n[Footer & badges]\n${footerSignals.join("\n")}` : "") + (structuredData.length ? `\n[Structured data]\n${structuredData.map((d) => `Structured data: ${d}`).join("\n")}` : "");
  let budget = maxChars - header.length - footer.length - 10;
  const chosen: Block[] = [];
  for (const b of [...unique].sort((a, b2) => score(b2) - score(a))) {
    const line = b.text.length > 600 ? `${b.text.slice(0, 600)}…` : b.text;
    if (line.length + 1 > budget) continue;
    budget -= line.length + 1;
    chosen.push({ ...b, text: line });
  }
  chosen.sort((a, b) => a.order - b.order);
  const body = chosen.map((b) => (/^h[1-3]$/.test(b.tag) ? `## ${b.text}` : b.text)).join("\n");
  const text = `${header}\n${body}${footer}`.trim();

  return {
    title,
    metaDescription,
    siteName,
    text,
    wordCount: totalWords,
    blocks: chosen.length,
    footerSignals,
    looksJsRendered: totalWords < 80 && (appShell || rawScriptCount >= 5),
    structuredData,
    metaWordCount: words([title, metaDescription, ...structuredData].join(" ")),
    shortLines,
  };
}

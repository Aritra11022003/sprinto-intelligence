// classifyPage(): map a URL (and optionally its anchor text / title) to a research page type.
import type { PageType } from "@/lib/types";

const RULES: Array<{ type: PageType; path: RegExp; text: RegExp }> = [
  { type: "security", path: /(^|\/)(security|trust|trust-center|trustcenter|compliance|soc-?2|iso-?27001|gdpr|privacy-and-security|security-and-compliance)(\/|$|\.)/i, text: /\b(security|trust( center)?|compliance|soc ?2)\b/i },
  { type: "careers", path: /(^|\/)(careers?|jobs|join(-us)?|work-with-us|hiring|open-roles|positions|vacancies)(\/|$|\.)/i, text: /\b(careers?|jobs|we'?re hiring|join (us|the team|our team)|open roles)\b/i },
  { type: "pricing", path: /(^|\/)(pricing|plans|plans-and-pricing|price|buy)(\/|$|\.)/i, text: /\b(pricing|plans)\b/i },
  { type: "customers", path: /(^|\/)(customers?|case-studies|case-study|success-stories|testimonials|clients)(\/|$|\.)/i, text: /\b(customers?|case stud(y|ies)|success stories|clients)\b/i },
  { type: "team", path: /(^|\/)(team|our-team|leadership|people|founders|management|meet-the-team)(\/|$|\.)/i, text: /\b(team|leadership|founders|our people)\b/i },
  { type: "about", path: /(^|\/)(about|about-us|company|our-story|who-we-are|mission|investors|press|newsroom)(\/|$|\.)/i, text: /\b(about( us)?|company|our story|investors|press)\b/i },
  { type: "product", path: /(^|\/)(product|products|platform|features|solutions|how-it-works|overview|use-cases)(\/|$|\.)/i, text: /\b(product|platform|features|solutions|how it works)\b/i },
];

export function classifyPage(url: string, anchorText = ""): PageType {
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    /* ignore */
  }
  if (path === "/" || path === "") return "homepage";
  for (const rule of RULES) if (rule.path.test(path)) return rule.type;
  for (const rule of RULES) if (anchorText && rule.text.test(anchorText) && anchorText.length < 40) return rule.type;
  return "other";
}

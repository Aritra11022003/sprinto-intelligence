// Pure (browser-safe) composition of the email that lands in the user's own inbox.
import type { ResearchState } from "@/lib/types";

/** The message that lands in the user's inbox: the draft, plus a short research footer. */
export function buildSelfEmail(s: ResearchState): { subject: string; body: string } {
  const who = s.contact ? `${s.contact.name}${s.contact.title ? `, ${s.contact.title}` : ""} at ${s.companyName ?? s.domain}` : `${s.companyName ?? s.domain} (no named contact found)`;
  const reasons = s.qualificationReasons.filter((r) => r.result === "pass").map((r) => `- ${r.gate}: ${r.explanation}`).join("\n");
  const sources = [...new Set(s.evidence.map((e) => e.sourceUrl))].slice(0, 6).map((u) => `- ${u}`).join("\n");
  const pains = s.painPoints.map((p, i) => `${i + 1}. ${p.problem} (hypothesis, confidence ${Math.round(p.confidence * 100)}%)`).join("\n");
  return {
    subject: s.emailSubject ?? "",
    body: [
      `[Sprinto Intelligence draft for ${who}. Sent only to you; the prospect has not been emailed.]`,
      "",
      s.emailBody ?? "",
      "",
      "----------------------------------------",
      `Why ${s.companyName ?? s.domain} qualified:`,
      reasons || "- (see dashboard)",
      "",
      "Pain-point hypotheses:",
      pains || "- (none)",
      "",
      `Why this contact: ${s.contact?.selectionReason ?? "No named decision-maker was found on the public pages fetched."}`,
      "",
      `Sources (${s.hitCount}/5 pages fetched):`,
      sources || "- (none)",
    ].join("\n"),
  };
}


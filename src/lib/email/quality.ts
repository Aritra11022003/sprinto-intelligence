// Code-side quality gate for generated emails.
import { quoteIsSupported } from "@/lib/agent/evidence";
import type { EmailDraft } from "@/lib/outreach/email";
import type { EvidenceItem } from "@/lib/types";

export const BANNED_PHRASES = [
  "hope this email finds you well", "hope this finds you well", "hope you're doing well", "hope you are doing well",
  "i came across your company", "touch base", "synergy", "circle back", "just checking in", "i wanted to reach out",
  "revolutionize", "game-changer", "game changer",
];

export function validateEmailDraft(draft: EmailDraft, ctx: { firstName: string | null; evidence: EvidenceItem[] }): string[] {
  const problems: string[] = [];
  const body = draft.body ?? "";
  const lower = body.toLowerCase();
  const words = body.split(/\s+/).filter(Boolean).length;
  if (ctx.firstName && !body.slice(0, 80).includes(ctx.firstName)) problems.push(`must greet the contact by first name (${ctx.firstName})`);
  for (const p of BANNED_PHRASES) if (lower.includes(p)) problems.push(`contains banned filler phrase "${p}"`);
  if (words < 50) problems.push(`too short (${words} words)`);
  if (words > 200) problems.push(`too long (${words} words)`);
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(body)) problems.push("must not contain email addresses");
  if (/https?:\/\//i.test(body)) problems.push("must not contain links");
  if (/\[(?!your name\])[^\]]{1,40}\]/i.test(body)) problems.push("contains an unfilled placeholder");
  if (!draft.subject?.trim() || draft.subject.length > 120) problems.push("subject missing or too long");
  const evidenceText = ctx.evidence.map((e) => `${e.supportingQuote}\n${e.value}`).join("\n");
  if (!quoteIsSupported(draft.hook_quote, evidenceText)) problems.push("the hook is not grounded in a collected evidence quote");
  return problems;
}

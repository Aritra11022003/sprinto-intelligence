// generate_email: a short, personalised first-touch email built from the top pain-point
// hypothesis and its evidence. No AI: every specific claim comes from a collected quote.
import type { EvidenceItem, ResearchState } from "@/lib/types";
import type { PainKind } from "./painpoints";

export interface EmailDraft { subject: string; body: string; hook_quote: string; hook_source_url: string; rationale: string }

// Lowercase the first letter only for ordinary words: "Enterprise plan" -> "enterprise plan", but keep "HIPAA", "SSO".
const lowerFirst = (s: string) => (s && !/^[A-Z]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const trimSentence = (s: string) => s.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();

function roleLabel(title: string | null): string {
  const t = (title ?? "").toLowerCase();
  if (/secur|ciso/.test(t)) return "someone who owns security";
  if (/complian|grc|risk/.test(t)) return "someone who owns compliance";
  if (/engineer|cto|technolog/.test(t)) return "someone running engineering";
  if (/ceo|founder/.test(t)) return "a founder";
  return "the person who'd own this";
}

export function generateEmail(s: ResearchState, kinds: PainKind[], hooks: EvidenceItem[]): EmailDraft {
  const company = s.companyName ?? s.domain;
  const first = s.contact?.name.split(/\s+/)[0] ?? null;
  const greeting = first ? `Hi ${first},` : `Hi ${company} team,`;
  const kind = kinds[0] ?? "no_cert";
  const hook = hooks[0];
  const v = hook ? trimSentence(hook.value) : "";

  const subjects: Record<PainKind, string> = {
    security_hiring: `${company}'s security hire and SOC 2`,
    enterprise: `${company}'s enterprise deals and SOC 2`,
    questionnaires: `security reviews at ${company}`,
    growth: `audit-readiness while ${company} scales`,
    funding: `SOC 2 after the ${s.fundingStage ?? "raise"}`,
    no_cert: `SOC 2 for ${company}`,
    customer_data: `customer trust at ${company}`,
  };
  const openers: Record<PainKind, string> = {
    security_hiring: `I saw ${company} is hiring for "${v.replace(/^Hiring for security\/compliance:\s*/i, "")}". That usually means compliance is moving from a side project to a real priority.`,
    enterprise: `I noticed ${company} offers ${lowerFirst(v)}. That usually means larger customers are starting to send security questionnaires and ask for a SOC 2 report.`,
    questionnaires: `I noticed ${company}'s site covers ${lowerFirst(v.replace(/ (mentioned|offered|published)$/i, ""))}. Teams at this point often find questionnaires and audit evidence quietly eating engineering time.`,
    growth: `With ${s.openRoleCount} open roles on your careers page, ${company} is clearly growing fast, and every new hire adds access reviews and onboarding evidence an auditor will ask for.`,
    funding: `Congrats on the ${s.fundingStage}. That is usually the point where enterprise prospects start asking for SOC 2 before they sign.`,
    no_cert: `I was looking at ${company}${s.companyDescription ? `: ${trimSentence(s.companyDescription)}` : " and what you're building for business customers"}. Teams selling to businesses usually get asked for SOC 2 or ISO 27001 before the bigger deals close.`,
    customer_data: `As ${company} grows its business customer base, more of them will want proof of how their data is protected, usually a SOC 2 report and a GDPR story.`,
  };
  const second = kinds[1]
    ? {
        security_hiring: "Is building the compliance programme from scratch part of that plan?",
        enterprise: "Are security reviews already slowing any deals down?",
        questionnaires: "Are questionnaires and evidence requests still handled manually?",
        growth: "Is keeping access reviews and offboarding evidence current getting harder as the team grows?",
        funding: "Is a formal certification on the roadmap after the round?",
        no_cert: "Is a first SOC 2 or ISO 27001 audit on the roadmap this year?",
        customer_data: "Are customers asking for proof of data protection yet?",
      }[kinds[1]]
    : "Is a first SOC 2 or ISO 27001 audit on the roadmap this year?";

  const body = [
    greeting,
    "",
    `${openers[kind]} ${second}`,
    "",
    `As ${roleLabel(s.contact?.title ?? null)}, you'd probably be the one carrying that. Sprinto automates SOC 2, ISO 27001 and GDPR compliance: it connects to your cloud, HR and code tools, monitors controls continuously and collects audit evidence automatically, so you get audit-ready without pulling engineers off the roadmap.`,
    "",
    "Would a 20-minute walkthrough next week be useful? Happy to send a short readiness checklist instead if that's easier.",
    "",
    "Best,",
    "[Your name]",
  ].join("\n");

  return {
    subject: subjects[kind],
    body,
    hook_quote: hook?.supportingQuote ?? "",
    hook_source_url: hook?.sourceUrl ?? "",
    rationale: `Opened on the strongest evidence-backed hypothesis (${kind.replace(/_/g, " ")}) from ${hook?.sourceUrl ?? "the research"}; second question targets ${kinds[1]?.replace(/_/g, " ") ?? "certification timing"}.`,
  };
}

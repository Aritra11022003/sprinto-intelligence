// generate_email: a short, personalised first-touch email built from the top pain-point
// hypothesis and its evidence. No AI: every specific claim comes from a collected quote.
// Wording varies per company (stable for the same domain) so a batch doesn't read like a mail merge.
import type { EvidenceItem, ResearchState } from "@/lib/types";
import type { PainKind } from "./painpoints";

export interface EmailDraft { subject: string; body: string; hook_quote: string; hook_source_url: string; rationale: string }

// Lowercase the first letter only for ordinary words: "Enterprise plan" -> "enterprise plan", but keep "HIPAA", "SSO".
const lowerFirst = (s: string) => (s && !/^[A-Z]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const trimSentence = (s: string) => s.replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
/** "Acme" -> "Acme's", "Plausible Analytics" -> "Plausible Analytics'". */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** Deterministic variant picker: same company → same email; different companies → different wording. */
function picker(seedText: string) {
  let h = 2166136261;
  for (const ch of seedText) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return <T,>(options: T[], salt: number): T => options[((h + Math.imul(salt + 1, 2654435761)) >>> 0) % options.length];
}

type Role = "security" | "compliance" | "engineering" | "founder" | "other";
function roleOf(title: string | null): Role {
  const t = (title ?? "").toLowerCase();
  if (/secur|ciso|infosec/.test(t)) return "security";
  if (/complian|grc|risk|trust/.test(t)) return "compliance";
  if (/engineer|cto|technolog|technical/.test(t)) return "engineering";
  if (/ceo|founder|president|coo|chief executive/.test(t)) return "founder";
  return "other";
}

/** Enterprise-signal label → a grammatical clause about the company. */
function enterpriseFact(company: string, label: string): string {
  const l = label.toLowerCase();
  if (/enterprise plan|tier/.test(l)) return `${company} now has an Enterprise plan`;
  if (/sso|saml/.test(l)) return `${company} offers SSO and SAML for enterprise customers`;
  if (/custom pricing|sales-led/.test(l)) return `${company} sells its larger plans through sales with custom pricing`;
  if (/audit log|sla|dedicated/.test(l)) return `${company} offers enterprise features like audit logs and dedicated support`;
  if (/large enterprises|fortune/.test(l)) return `${company} is already selling to large enterprises`;
  return `${company} has an enterprise offering (${lowerFirst(label)})`;
}

/** Turn an enterprise-signal label into a grammatical opening sentence. */
export function enterpriseHook(company: string, label: string): string {
  return `I noticed ${enterpriseFact(company, label)}.`;
}

export function generateEmail(s: ResearchState, kinds: PainKind[], hooks: EvidenceItem[]): EmailDraft {
  const company = s.companyName ?? s.domain;
  const pick = picker(s.domain);
  const first = s.contact?.name.split(/\s+/)[0] ?? null;
  const greeting = first ? pick([`Hi ${first},`, `Hi ${first},`, `Hello ${first},`], 1) : `Hi ${company} team,`;
  const kind = kinds[0] ?? "no_cert";
  const hook = hooks[0];
  const v = hook ? trimSentence(hook.value) : "";
  const role = roleOf(s.contact?.title ?? null);
  const desc = s.companyDescription ? trimSentence(s.companyDescription) : null;
  const roleName = v.replace(/^Hiring for security\/compliance:\s*/i, "");
  const topic = lowerFirst(v.replace(/ (mentioned|offered|published|obligations mentioned)$/i, ""));

  const subjects: Record<PainKind, string[]> = {
    security_hiring: [`${possessive(company)} security hire and SOC 2`, `the ${roleName} role at ${company}`, `before your new security hire starts`],
    enterprise: [`${possessive(company)} enterprise deals and SOC 2`, `SOC 2 for ${possessive(company)} enterprise customers`, `enterprise security reviews at ${company}`],
    questionnaires: [`security reviews at ${company}`, `questionnaires at ${company}`, `${possessive(company)} compliance paperwork`],
    growth: [`audit-readiness while ${company} scales`, `${s.openRoleCount} open roles and SOC 2`, `hiring fast at ${company}`],
    funding: [`SOC 2 after the ${s.fundingStage ?? "raise"}`, `${possessive(company)} ${s.fundingStage ?? "raise"} and enterprise deals`],
    no_cert: [`SOC 2 for ${company}`, `${possessive(company)} first audit`, `a question about ${possessive(company)} security reviews`],
    customer_data: [`customer trust at ${company}`, `proving data protection at ${company}`],
  };

  const openers: Record<PainKind, string[]> = {
    security_hiring: [
      `I saw ${company} is hiring for "${roleName}". That usually means compliance is moving from a side project to a real priority.`,
      `Your opening for "${roleName}" caught my eye. Teams usually make that hire right when customers start asking for formal proof of security.`,
    ],
    enterprise: /large enterprises|fortune/i.test(v) ? [
      `I noticed ${enterpriseFact(company, v)}. Big customers like that almost always run a security review, and a SOC 2 report is usually the first thing they ask for.`,
      `Saw that ${enterpriseFact(company, v)}. Those deals usually come with long security questionnaires and a request for a SOC 2 report.`,
    ] : [
      `I noticed ${enterpriseFact(company, v)}. That usually means larger customers are starting to send security questionnaires and ask for a SOC 2 report.`,
      `Saw that ${enterpriseFact(company, v)}. In my experience, that's about when procurement teams start asking for a SOC 2 report before signing.`,
      `${enterpriseFact(company, v).replace(/^./, (c) => c.toUpperCase())}, which tells me bigger customers are already in the pipeline, and they tend to bring security reviews with them.`,
    ],
    questionnaires: [
      `I noticed ${possessive(company)} site covers ${topic}. Teams at this point often find questionnaires and audit evidence quietly eating engineering time.`,
      `Reading ${possessive(company)} site, I saw it addresses ${topic}. That usually comes with a steady stream of security questionnaires from customers.`,
    ],
    growth: [
      `With ${s.openRoleCount} open roles on your careers page, ${company} is clearly growing fast, and every new hire adds access reviews and onboarding evidence an auditor will ask for.`,
      `${s.openRoleCount} open roles is a lot of onboarding. Each new laptop, account and access grant is something an auditor will eventually want evidence for.`,
    ],
    funding: [
      `Congrats on the ${s.fundingStage}. That's usually the point where enterprise prospects start asking for SOC 2 before they sign.`,
      `Congratulations on the ${s.fundingStage}. Post-raise is typically when the board and bigger customers start expecting a formal security posture.`,
    ],
    no_cert: [
      `I was looking at ${company}${desc ? `: "${desc}"` : " and what you're building for business customers"}. Teams selling to businesses usually get asked for SOC 2 or ISO 27001 before the bigger deals close.`,
      `${desc ? `"${desc}" is a strong pitch for business buyers.` : `${company} is clearly built for business buyers.`} The catch is that those buyers increasingly want a SOC 2 report before they sign.`,
      `I couldn't find a SOC 2 or ISO 27001 report on ${possessive(company)} site, which is common at your stage, but it's often the first thing a large customer's security team asks for.`,
    ],
    customer_data: [
      `As ${company} grows its business customer base, more of them will want proof of how their data is protected, usually a SOC 2 report and a GDPR story.`,
      `Business customers are getting stricter about where their data lives. For a company like ${company}, that usually turns into requests for SOC 2 and GDPR evidence.`,
    ],
  };

  const followUps: Record<PainKind, string[]> = {
    security_hiring: ["Is building the compliance programme from scratch part of that plan?", "Will that person be starting SOC 2 from a blank page?"],
    enterprise: ["Are security reviews already slowing any deals down?", "Has a deal stalled in security review yet?"],
    questionnaires: ["Are questionnaires and evidence requests still handled manually?", "Who answers those questionnaires today?"],
    growth: ["Is keeping access reviews and offboarding evidence current getting harder as the team grows?", "Is offboarding evidence keeping up with the hiring?"],
    funding: ["Is a formal certification on the roadmap after the round?", "Is SOC 2 part of the post-raise plan?"],
    no_cert: ["Is a first SOC 2 or ISO 27001 audit on the roadmap this year?", "Is a first audit on the cards this year?"],
    customer_data: ["Are customers asking for proof of data protection yet?", "Have customers started asking for a SOC 2 report?"],
  };
  const followUp = pick(followUps[kinds[1] ?? "no_cert"], 3);

  const roleLines: Record<Role, string[]> = {
    security: ["As the person who owns security, you'd likely end up running that audit.", "That work tends to land on whoever owns security, which sounds like you."],
    compliance: ["Since you own compliance, the evidence-chasing would land on your desk.", "That's squarely the compliance team's problem, which I'm guessing means yours."],
    engineering: ["On the engineering side, that usually means engineers screenshotting configs instead of shipping.", "For engineering leaders, audit prep usually means pulling people off the roadmap for weeks."],
    founder: ["At this stage it's often the founder who ends up running the audit.", "Before there's a dedicated security hire, this usually lands on the founders."],
    other: ["Whoever owns security there would probably carry that work.", "Someone on the team usually ends up owning that work."],
  };

  const valueProps = [
    "Sprinto automates SOC 2, ISO 27001 and GDPR compliance: it connects to your cloud, HR and code tools, monitors controls continuously and collects audit evidence automatically, so you get audit-ready without pulling engineers off the roadmap.",
    "Sprinto plugs into your cloud, HR and code tools, maps them to SOC 2, ISO 27001 and GDPR controls, and collects the audit evidence automatically, so the team keeps building while you get audit-ready.",
    "That's what Sprinto is for: continuous control monitoring and automatic evidence collection across your cloud, HR and code tools, covering SOC 2, ISO 27001 and GDPR.",
  ];
  const ctas = [
    "Would a 20-minute walkthrough next week be useful? Happy to send a short readiness checklist instead if that's easier.",
    "Worth a quick 20-minute call to see how it would map to your stack? Or I can just send over a readiness checklist.",
    "Open to a short call next week? If not, I'm happy to share a one-page SOC 2 readiness checklist.",
  ];
  const signOff = pick(["Best,", "Thanks,", "Cheers,"], 7);

  const body = [
    greeting,
    "",
    `${pick(openers[kind], 2)} ${followUp}`,
    "",
    `${pick(roleLines[role], 4)} ${pick(valueProps, 5)}`,
    "",
    pick(ctas, 6),
    "",
    signOff,
    "[Your name]",
  ].join("\n");

  return {
    subject: pick(subjects[kind], 0),
    body,
    hook_quote: hook?.supportingQuote ?? "",
    hook_source_url: hook?.sourceUrl ?? "",
    rationale: `Opened on the strongest evidence-backed hypothesis (${kind.replace(/_/g, " ")}) from ${hook?.sourceUrl ?? "the research"}; follow-up targets ${kinds[1]?.replace(/_/g, " ") ?? "certification timing"}; role line tailored to a ${role} contact.`,
  };
}

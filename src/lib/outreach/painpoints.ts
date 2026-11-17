// identify_pain_points: exactly two evidence-backed hypotheses, chosen by fixed rules.
// Each is labelled a hypothesis and cites the evidence item it rests on.
import type { EvidenceItem, PainPoint, ResearchState } from "@/lib/types";

export type PainKind = "enterprise" | "security_hiring" | "growth" | "questionnaires" | "funding" | "no_cert" | "customer_data";

export interface PainCandidate { kind: PainKind; pain: PainPoint; evidence: EvidenceItem }

function roleRelevance(title: string | null, kind: PainKind): string {
  const t = (title ?? "").toLowerCase();
  if (/secur|ciso|infosec/.test(t)) return "As the security leader, they own security reviews and would run the audit, so manual evidence collection lands on their team.";
  if (/complian|grc|risk|trust/.test(t)) return "They own the compliance programme, so audit readiness and evidence collection are their day-to-day job.";
  if (/engineer|cto|technology|technical/.test(t)) return "Audit prep and questionnaires usually pull engineers off the roadmap, which a technical leader feels directly.";
  if (/ceo|founder|coo|operat/.test(t)) return kind === "enterprise" || kind === "funding" ? "Compliance gates revenue: stalled enterprise deals and investor expectations land on the founder's desk." : "At this stage founders typically own SOC 2 themselves, on top of everything else.";
  return "Whoever owns security and compliance will feel the time cost of audits and customer security reviews.";
}

export function painCandidates(s: ResearchState): PainCandidate[] {
  const ev = (field: string, filter: (e: EvidenceItem) => boolean = () => true) => s.evidence.find((e) => e.field === field && filter(e));
  const title = s.contact?.title ?? null;
  const name = s.companyName ?? s.domain;
  const out: PainCandidate[] = [];
  const add = (kind: PainKind, e: EvidenceItem | undefined, problem: string, angle: string, confidence: number) => {
    if (!e) return;
    out.push({ kind, evidence: e, pain: { problem, evidence: `"${e.supportingQuote}"`, evidenceUrls: [e.sourceUrl], roleRelevance: roleRelevance(title, kind), confidence, outreachAngle: angle, label: "hypothesis" } });
  };

  add("security_hiring", ev("compliance_signal", (e) => /^Hiring for security/i.test(e.value)),
    `${name} is likely building a security/compliance function and needs a repeatable way to get and stay audit-ready.`,
    "Open on the security/compliance hire: Sprinto lets a small team run SOC 2 without building the programme from scratch.", 0.8);
  add("enterprise", ev("enterprise_signal"),
    `Enterprise buyers are likely asking ${name} for SOC 2 / ISO 27001 evidence and security questionnaires before they sign.`,
    "Open on their enterprise offering: larger deals tend to stall in security review without a SOC 2 report.", 0.75);
  add("questionnaires", ev("compliance_signal", (e) => !/^Hiring for security/i.test(e.value)),
    `${name} likely handles security questionnaires and compliance obligations (e.g. GDPR) manually today.`,
    "Open on their published compliance commitments: Sprinto turns them into continuously monitored controls.", 0.7);
  if ((s.openRoleCount ?? 0) >= 5) {
    add("growth", ev("open_role_count") ?? ev("open_role"),
      `With ${s.openRoleCount} open roles, onboarding, offboarding and access-review evidence will get harder to keep audit-ready.`,
      "Open on their hiring pace: every new hire adds controls an auditor will check.", 0.65);
  }
  add("funding", ev("funding_stage", (e) => /Series [ABC]/.test(e.value)),
    `After the ${s.fundingStage} round, customers and the board are likely to expect a formal, certified security posture.`,
    "Open on the funding round: this is when enterprise prospects start requiring SOC 2.", 0.6);
  add("no_cert", ev("product_description") ?? ev("is_b2b"),
    `${name} sells to businesses but shows no SOC 2 / ISO 27001 certification, so deals may stall in procurement.`,
    "Open on what they sell and who buys it: business buyers increasingly require a SOC 2 report.", 0.5);
  add("customer_data", ev("is_b2b") ?? ev("is_saas"),
    `As a B2B software provider, ${name} handles customer data and is likely to face GDPR and security-review expectations.`,
    "Open on customer trust: proving data protection without a big compliance team.", 0.45);
  return out;
}

/** Exactly two distinct hypotheses (fewer only if there is no evidence at all). */
export function identifyPainPoints(s: ResearchState): { painPoints: PainPoint[]; kinds: PainKind[]; hooks: EvidenceItem[] } {
  const seen = new Set<string>();
  const picked = painCandidates(s).filter((c) => (seen.has(c.evidence.supportingQuote) ? false : (seen.add(c.evidence.supportingQuote), true))).slice(0, 2);
  return { painPoints: picked.map((p) => p.pain), kinds: picked.map((p) => p.kind), hooks: picked.map((p) => p.evidence) };
}

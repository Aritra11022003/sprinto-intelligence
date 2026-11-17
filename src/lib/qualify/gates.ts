// qualify_company: deterministic, code-enforced ICP gates. The model's explanation is stored
// separately (state.modelExplanation) and never changes the decision made here.
import type { EvidenceItem, Qualification, QualificationReason, ResearchState } from "@/lib/types";

const ref = (e: EvidenceItem) => ({ field: e.field, value: e.value, sourceUrl: e.sourceUrl, supportingQuote: e.supportingQuote });
const ev = (s: ResearchState, ...fields: string[]) => s.evidence.filter((e) => fields.includes(e.field));

const ICP_STAGES = new Set(["Series A", "Series B", "Series C"]);
const ENTERPRISE_TIER_RE = /enterprise (plan|tier|pricing|edition|package)|\benterprise\b.*\b(plan|tier|pricing|custom)|custom (pricing|plan|quote)|contact sales|talk to sales|\bsso\b|\bsaml\b/i;

export interface StageSignal { kind: "funding_stage" | "open_roles" | "enterprise_pricing"; description: string; evidence: EvidenceItem[] }

export function stageSignals(s: ResearchState): StageSignal[] {
  const out: StageSignal[] = [];
  const funding = ev(s, "funding_stage").filter((e) => ICP_STAGES.has(e.value));
  if (funding.length) out.push({ kind: "funding_stage", description: `Funding stage named: ${funding[0].value}`, evidence: funding.slice(0, 2) });
  if ((s.openRoleCount ?? 0) >= 5) {
    out.push({ kind: "open_roles", description: `${s.openRoleCount} open roles listed (threshold: 5)`, evidence: ev(s, "open_role_count", "open_role").slice(0, 6) });
  }
  const tiers = ev(s, "enterprise_signal").filter((e) => ENTERPRISE_TIER_RE.test(`${e.value} ${e.supportingQuote}`));
  if (tiers.length) out.push({ kind: "enterprise_pricing", description: `Enterprise-tier offering: ${tiers[0].value}`, evidence: tiers.slice(0, 3) });
  return out;
}

export type RequiredField = "certification_status" | "b2b_saas" | "stage";

/** Which required facts are still missing. Checked in code: a field is populated or it is not. */
export function missingRequiredFields(s: ResearchState): RequiredField[] {
  const missing: RequiredField[] = [];
  if (s.certificationStatus === "unknown") missing.push("certification_status");
  if (s.isSaas === null || s.isB2B === null) missing.push("b2b_saas");
  if (stageSignals(s).length === 0) missing.push("stage");
  return missing;
}

export function isShortCircuited(s: ResearchState): string | null {
  if (s.namedCertifications.length > 0) return `Named certification found (${s.namedCertifications.join(", ")}): already certified`;
  if (s.isSaas === false) return "Evidence shows the company does not sell a software product";
  if (s.isB2B === false) return "Evidence shows the company sells to consumers, not businesses";
  return null;
}

export interface QualificationResult {
  qualification: Qualification;
  certificationStatus: ResearchState["certificationStatus"];
  reasons: QualificationReason[];
  summary: string;
}

export function qualifyCompany(s: ResearchState): QualificationResult {
  const reasons: QualificationReason[] = [];
  const hasContent = s.pages.some((p) => p.fetchStatus === "ok" && p.wordCount >= 20);

  // No usable content: never manufacture a result from nothing.
  if (!hasContent) {
    return {
      qualification: "incomplete",
      certificationStatus: "unknown",
      reasons: [{ gate: "certification", result: "unknown", explanation: "No readable website content could be retrieved, so no gate could be evaluated.", evidence: [] }],
      summary: "Incomplete: no usable website content was retrieved.",
    };
  }

  // Gate 1: certification.
  const certEvidence = ev(s, "certification");
  if (s.namedCertifications.length > 0 && certEvidence.length > 0) {
    reasons.push({ gate: "certification", result: "fail", explanation: `Already holds ${s.namedCertifications.join(", ")}. Sprinto's first-certification pitch does not apply.`, evidence: certEvidence.slice(0, 3).map(ref) });
    return { qualification: "disqualified", certificationStatus: "certified", reasons, summary: `Disqualified: already certified (${s.namedCertifications.join(", ")}).` };
  }
  const checkedTrust = s.pages.some((p) => p.pageType === "security" && p.fetchStatus === "ok");
  reasons.push({
    gate: "certification",
    result: "pass",
    explanation: checkedTrust
      ? "No named certification found on the homepage or the security/trust page. This does not prove the company has none."
      : "No named certification found on the pages checked (no security/trust page was available). This does not prove the company has none.",
    evidence: [],
  });

  // Gate 2: B2B SaaS.
  const saasEv = ev(s, "is_saas", "is_b2b", "product_description");
  if (s.isSaas === false || s.isB2B === false) {
    reasons.push({ gate: "b2b_saas", result: "fail", explanation: s.isSaas === false ? "Evidence shows the company does not sell a software product." : "Evidence shows the product is sold to consumers, not businesses.", evidence: saasEv.slice(0, 3).map(ref) });
    return { qualification: "disqualified", certificationStatus: "not_found", reasons, summary: "Disqualified: not a B2B SaaS business." };
  }
  if (s.isSaas !== true || s.isB2B !== true) {
    reasons.push({ gate: "b2b_saas", result: "unknown", explanation: `Could not confirm from the website that this is ${s.isSaas !== true ? "a software product" : "sold to businesses"}.`, evidence: saasEv.slice(0, 3).map(ref) });
  } else {
    reasons.push({ gate: "b2b_saas", result: "pass", explanation: "The product description identifies a software product and a business buyer.", evidence: saasEv.slice(0, 3).map(ref) });
  }

  // Gate 3: stage.
  const signals = stageSignals(s);
  if (signals.length) {
    reasons.push({ gate: "stage", result: "pass", explanation: signals.map((x) => x.description).join("; "), evidence: signals.flatMap((x) => x.evidence).slice(0, 6).map(ref) });
  } else {
    const otherStage = ev(s, "funding_stage")[0];
    reasons.push({
      gate: "stage",
      result: "unknown",
      explanation: otherStage
        ? `Funding stage found (${otherStage.value}) is outside the typical Series A–C band, and no other stage signal (5+ open roles, enterprise tier) was found.`
        : "No stage evidence found: no named funding round, fewer than 5 open roles listed, and no enterprise pricing tier.",
      evidence: otherStage ? [ref(otherStage)] : [],
    });
  }

  // Informational: compliance pressure (feeds pain points; not a hard gate).
  const pressure = ev(s, "compliance_signal", "enterprise_signal");
  reasons.push({
    gate: "compliance_pressure",
    result: pressure.length ? "pass" : "unknown",
    explanation: pressure.length ? `Compliance / enterprise pressure signals: ${[...new Set(pressure.map((p) => p.value))].slice(0, 4).join("; ")}` : "No explicit compliance-pressure signal found (informational only).",
    evidence: pressure.slice(0, 4).map(ref),
  });

  const b2b = reasons.find((r) => r.gate === "b2b_saas")!;
  const stage = reasons.find((r) => r.gate === "stage")!;
  if (b2b.result === "pass" && stage.result === "pass") {
    return { qualification: "qualified", certificationStatus: "not_found", reasons, summary: "Qualified: B2B SaaS, no certification found, with stage evidence." };
  }
  const why = [b2b.result !== "pass" && "B2B SaaS not confirmed", stage.result !== "pass" && "no stage evidence"].filter(Boolean).join(" and ");
  return { qualification: "manual_review", certificationStatus: "not_found", reasons, summary: `Manual review: ${why}.` };
}

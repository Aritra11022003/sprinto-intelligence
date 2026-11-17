// Shared domain types for Sprinto Intelligence.

export const MAX_HITS = 5 as const;
export const MAX_FETCH_RETRIES = 3 as const;

export type Qualification = "pending" | "qualified" | "disqualified" | "manual_review" | "incomplete";
export type CertificationStatus = "unknown" | "certified" | "not_found";
export type PageType = "homepage" | "security" | "careers" | "pricing" | "customers" | "about" | "team" | "product" | "other";

/** The ten user-visible research stages. */
export const STAGES = [
  { key: "homepage_fetch", label: "Homepage fetch" },
  { key: "content_cleaning", label: "Content cleaning" },
  { key: "structured_extraction", label: "Structured extraction" },
  { key: "evidence_validation", label: "Evidence validation" },
  { key: "adaptive_research", label: "Adaptive research" },
  { key: "icp_qualification", label: "ICP qualification" },
  { key: "contact_discovery", label: "Contact discovery" },
  { key: "pain_point_analysis", label: "Pain-point analysis" },
  { key: "email_drafting", label: "Email drafting" },
  { key: "gmail_delivery", label: "Gmail delivery" },
] as const;
export type StageKey = (typeof STAGES)[number]["key"] | "queued" | "completed" | "escalated";

export type ResearchStatus = "queued" | "running" | "completed" | "escalated";

export type FetchStatus =
  | "ok" | "not_found" | "blocked" | "captcha" | "login_required" | "robots_disallowed" | "empty"
  | "non_html" | "too_large" | "timeout" | "network_error" | "dns_error" | "ssrf_blocked" | "http_error";

export interface EvidenceItem {
  field: string;
  value: string;
  sourceUrl: string;
  sourceTitle: string;
  extractedAt: string;
  confidence: number;
  supportingQuote: string;
}

export interface PageRecord {
  url: string;
  pageType: PageType;
  hitNumber: number;
  fetchStatus: FetchStatus;
  httpStatus: number | null;
  selectionReason: string;
  targetField: string | null;
  title: string;
  wordCount: number;
  attempts: number;
  fetchedAt: string;
}

export interface CandidateLink {
  url: string;
  pageType: PageType;
  anchorText: string;
  source: "homepage_link" | "sitemap" | "guessed_path";
  score: number;
}

export interface QualificationReason {
  gate: "certification" | "b2b_saas" | "stage" | "compliance_pressure";
  result: "pass" | "fail" | "unknown";
  explanation: string;
  evidence: Array<Pick<EvidenceItem, "field" | "value" | "sourceUrl" | "supportingQuote">>;
}

export interface Contact {
  name: string;
  title: string | null;
  source: "website" | "manual";
  sourceUrl: string | null;
  supportingQuote: string | null;
  selectionReason: string;
}

export interface PainPoint {
  problem: string;
  evidence: string;
  evidenceUrls: string[];
  roleRelevance: string;
  confidence: number;
  outreachAngle: string;
  label: "hypothesis";
}

export type EmailStatus = "none" | "draft" | "sent" | "failed" | "not_configured";
export type ContactStatus = "not_started" | "found" | "none_found" | "manual";

export interface ResearchState {
  id: string;
  domain: string;
  siteHost: string;
  companyName: string | null;
  hitCount: number;
  maxHits: typeof MAX_HITS;
  visitedUrls: string[];
  candidateLinks: CandidateLink[];
  pages: PageRecord[];
  retryCounts: Record<string, number>;
  /** Page fetches spent on each missing field. */
  fieldAttempts: Record<string, number>;
  companyDescription: string | null;
  isSaas: boolean | null;
  isB2B: boolean | null;
  certificationStatus: CertificationStatus;
  namedCertifications: string[];
  fundingStage: string | null;
  openRoleCount: number | null;
  hiringSignals: string[];
  enterpriseSignals: string[];
  complianceSignals: string[];
  evidence: EvidenceItem[];
  rejectedEvidence: number;
  missingFields: string[];
  nextResearchTarget: string | null;
  nextResearchReason: string | null;
  nextResearchField: string | null;
  stopReason: string | null;
  qualification: Qualification;
  qualificationReasons: QualificationReason[];
  contactStatus: ContactStatus;
  contact: Contact | null;
  contactCandidates: Contact[];
  painPoints: PainPoint[];
  emailSubject: string | null;
  emailBody: string | null;
  emailStatus: EmailStatus;
  emailError: string | null;
  emailMessageId: string | null;
  stage: StageKey;
  status: ResearchStatus;
  loopIterations: number;
  errors: string[];
  log: Array<{ at: string; stage: string; event: string; details: Record<string, unknown> }>;
  startedAt: string | null;
  completedAt: string | null;
}

export function initialState(input: { id: string; domain: string; manualContact?: { name: string; title: string } | null }): ResearchState {
  const manual: Contact | null = input.manualContact
    ? { name: input.manualContact.name, title: input.manualContact.title || null, source: "manual", sourceUrl: null, supportingQuote: null, selectionReason: "Provided in the input (manual contact)." }
    : null;
  return {
    id: input.id,
    domain: input.domain,
    siteHost: input.domain,
    companyName: null,
    hitCount: 0,
    maxHits: MAX_HITS,
    visitedUrls: [],
    candidateLinks: [],
    pages: [],
    retryCounts: {},
    fieldAttempts: {},
    companyDescription: null,
    isSaas: null,
    isB2B: null,
    certificationStatus: "unknown",
    namedCertifications: [],
    fundingStage: null,
    openRoleCount: null,
    hiringSignals: [],
    enterpriseSignals: [],
    complianceSignals: [],
    evidence: [],
    rejectedEvidence: 0,
    missingFields: [],
    nextResearchTarget: null,
    nextResearchReason: null,
    nextResearchField: null,
    stopReason: null,
    qualification: "pending",
    qualificationReasons: [],
    contactStatus: manual ? "manual" : "not_started",
    contact: manual,
    contactCandidates: manual ? [manual] : [],
    painPoints: [],
    emailSubject: null,
    emailBody: null,
    emailStatus: "none",
    emailError: null,
    emailMessageId: null,
    stage: "queued",
    status: "queued",
    loopIterations: 0,
    errors: [],
    log: [],
    startedAt: null,
    completedAt: null,
  };
}

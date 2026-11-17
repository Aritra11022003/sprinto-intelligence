// Agent tool registry. Every description states: what it does, when to use it, when NOT to use
// it, and what it returns. The retry policy column is the "two questions" table from L6:
// is the failure transient or permanent, and does anything downstream depend on it?

export interface ToolSpec {
  name: string;
  node: string;
  description: string;
  retryPolicy: string;
}

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: "fetch_page(url)",
    node: "fetch_page",
    description:
      "Fetches one publicly accessible company page and returns its HTML or a structured fetch failure. Use when a specific research URL has been selected and the five-hit budget permits it. Do not use for login-protected pages, CAPTCHA-protected pages, URLs disallowed by robots.txt, private/internal addresses, or any URL already fetched for this company. Returns status, final URL, HTTP status, response content and fetch metadata (attempts, method).",
    retryPolicy: "Transient (timeout, connection error, 429, 5xx): retry up to 3 times with backoff, same hit. Permanent 404: skip URL. CAPTCHA / login / robots disallow: stop, never bypass. Homepage failure: escalate (everything depends on it).",
  },
  {
    name: "extract_company_facts(content)",
    node: "extract_facts",
    description:
      "Extracts named company facts (product, buyer, certifications, funding, open roles, enterprise and compliance signals) from cleaned page content using deterministic rules. Use after cleaning a successfully fetched page with readable text. Do not use on empty pages, and do not treat navigation, footer text, slogans or vendor marketing as evidence. Returns structured fields, each with a verbatim supporting sentence and source URL; claims whose quote is not found on the page are rejected.",
    retryPolicy: "Pure function: cannot fail transiently. Empty pages are skipped so they never create a qualification.",
  },
  {
    name: "select_next_source(state)",
    node: "select_next_source",
    description:
      "Selects the most useful publicly accessible same-domain page to resolve a missing required fact (certification status, B2B SaaS, stage). Use when required fields remain incomplete and the hit budget permits another fetch. Do not call if the company is already disqualified, all required facts are known, or the hit limit is exhausted. Returns one proposed URL, the missing fact it addresses and the reason for selection.",
    retryPolicy: "Deterministic, cannot fail transiently. If no candidate remains, research stops and the missing facts are flagged.",
  },
  {
    name: "qualify_company(state)",
    node: "qualify_company",
    description:
      "Applies the Sprinto qualification gates (certification, B2B SaaS, stage) to the accumulated evidence in code. Use after required facts have been checked or the research budget is exhausted. Do not invent facts or interpret unknown as false. Returns qualification status (qualified / disqualified / manual_review / incomplete), reasons with evidence references, and missing information.",
    retryPolicy: "Pure function over stored evidence: no retries needed.",
  },
  {
    name: "find_contact(domain)",
    node: "discover_contact",
    description:
      "Finds named decision-makers on the company's own public pages (team, leadership, about, homepage), ranked by role relevance (CISO / Head of Security, Head of Compliance, VP Engineering, CTO, COO, Founder/CEO). A contact supplied in the input (domain | Name | Title) takes precedence. Use after a company would qualify. Do not guess names and do not use for disqualified companies. Returns the selected name, title, source page and quote, or none.",
    retryPolicy: "A team page costs one of the five hits and is fetched only when the company would qualify. If nobody is found, contact is marked missing and the email is addressed to the team; never invented.",
  },
  {
    name: "identify_pain_points(state)",
    node: "identify_pain_points",
    description:
      "Generates exactly two compliance pain-point hypotheses for a qualified company, each tied to a specific evidence item and the contact's role. Use after qualification (and contact discovery, when available). Do not present hypotheses as facts or cite evidence that was not collected. Returns two hypotheses with evidence, source URLs, role relevance, confidence and outreach angle.",
    retryPolicy: "Deterministic rules over collected evidence: cannot fail transiently.",
  },
  {
    name: "generate_email(state)",
    node: "generate_email",
    description:
      "Creates a personalised first-touch email based only on supported company and contact evidence. Use after qualification, contact selection and pain-point analysis. Do not use without a real contact, and do not fabricate company events, customer names, compliance problems or personal details. Returns subject, body, the evidence quote used as the hook and a rationale. The draft is checked in code (first name, banned phrases, length, hook evidence).",
    retryPolicy: "Quality-check failure: keep the draft, flag it and do not auto-send.",
  },
  {
    name: "send_email_to_self(subject, body)",
    node: "save_results",
    description:
      "Sends the generated research email to the configured user's own inbox (GMAIL_USER_EMAIL). Use after the email is generated and validated. Never send to the prospect or to any address other than the configured user. Returns Gmail message ID and send status.",
    retryPolicy: "Failure is recorded on the draft and the draft is preserved; the user can resend from the dashboard. A send key prevents duplicate sends of the same draft.",
  },
];

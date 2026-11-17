# Sprinto Intelligence

Adaptive, evidence-backed prospect research and cold-email drafting for **Sprinto** (SOC 2 / ISO 27001 / GDPR compliance automation).

**No paid APIs. No database. No AI keys.** The only configuration is email to yourself: Gmail with an app password (preferred) or Resend's free tier (backup). Both are free.

Paste a list of company domains. For each company the agent:

1. **Scrapes** the homepage (hit 1) for raw signal.
2. **Extracts** structured facts with deterministic rules. Every fact carries a verbatim sentence from the page, which code re-checks against the fetched text.
3. **Qualifies** the company against Sprinto's ICP with fixed gates. An **adaptive loop** fetches up to 4 more pages, chosen *only for the facts still missing*.
4. **Finds the decision-maker** on the company's own team / about pages, ranked by role (Security > Compliance > VP Eng > CTO > COO > Founder/CEO). You can also supply one in the input (`acme.com | Priya Raman | CTO`, the brief's "Option B"). Contacts are never guessed, and testimonial authors from other companies are filtered out.
5. **Identifies two pain-point hypotheses**, each tied to a specific quote and to the contact's role.
6. **Drafts a personalised email** addressed by name, opening on a hook grounded in a collected quote.
7. **Sends it to your own inbox** (never to the prospect) through Gmail, or Resend as a free backup, with a footer explaining why the company qualified, why this person, and the sources.

Progress streams live to the dashboard. Results and history are saved in your browser.

---

## The five-hit rule

Each company gets **at most five unique page fetches**. The homepage is always hit 1.

* Enforced in code by `reserveHit()` (`src/lib/agent/hit-budget.ts`) *before* any network request. A sixth unique page is impossible.
* Retries of the same URL (timeouts, 5xx, 429) reuse the same hit and have their own bounded counter (max 3 retries).
* `robots.txt` and `sitemap.xml` are access metadata, not company pages. The sitemap supplies *known* URLs, so the agent doesn't burn hits guessing paths that 404.

## ICP definition (qualification gates)

Based on the Evidence Map from L4. Code decides whether a field is populated.

| Gate | Question | Sufficient when | Fetch budget | If unanswered | Short-circuit |
|---|---|---|---|---|---|
| 1 Certification | Already certified? | A named certification (SOC 2, ISO 27001, PCI DSS, …) the company **itself** holds, quoted from the homepage, footer badges or the security/trust page. Vendor marketing ("get SOC 2 in weeks") does not count | 1 page | `not_found`, worded as "not proof of none" | **Yes**: disqualify and stop |
| 2 B2B SaaS | Software sold to businesses? | A sentence naming a software product **and** a sentence naming a business buyer | 1 page | `manual_review` | **Yes**: disqualify if disproved (e.g. shop, consumer product) |
| 3 Stage | Series A–C-like? | Any of: Series A/B/C named in a funding sentence · ≥5 open roles · enterprise tier (Enterprise plan, SSO/SAML, custom pricing) | 2 pages (careers → pricing → customers → about) | `manual_review` | — |
| Signal | Compliance pressure | Security/compliance hiring, GDPR/DPA, security questionnaires, … | — | informational (feeds pain points) | — |

Final status: **QUALIFIED** · **DISQUALIFIED** · **MANUAL REVIEW** · **INCOMPLETE** (no readable content: blocked, CAPTCHA, login, JavaScript-only site, bad domain).

Outreach (contact → pain points → email) runs for QUALIFIED companies. It also runs for MANUAL REVIEW companies where B2B SaaS is confirmed and no certification was found but stage is unknown ("qualify at lower rank, flagged" in the L4 evidence map). Those drafts are clearly flagged.

## Architecture

```
Browser (Next.js page) ──POST /api/research──▶ Vercel function (streams NDJSON progress)
      ▲   live updates per node                       │
      │                                    LangGraph state machine, one per company (5 in parallel)
 localStorage history                      initialize → fetch_page → clean_content → extract_facts
                                           → validate_required_fields ↺ select_next_source (≤5 hits)
                                           → qualify_company → discover_contact → identify_pain_points
                                           → generate_email → save_results (Gmail or Resend → your inbox)
                                           → complete_or_escalate
```

| Path | What it does |
|---|---|
| `src/lib/agent/graph.ts` | LangGraph nodes and edges; every node emits state for live progress |
| `src/lib/agent/hit-budget.ts` | Five-hit enforcement |
| `src/lib/agent/source-selection.ts` | Deterministic choice of the next page from the first missing field |
| `src/lib/agent/evidence.ts` | Quote verification and fact merging |
| `src/lib/agent/tools.ts` | Tool descriptions (what / when / when not / returns) plus the retry policy |
| `src/lib/extract/rules.ts` | Rule-based fact extraction (product, buyer, certifications, funding, roles, signals) |
| `src/lib/qualify/gates.ts` | ICP gates |
| `src/lib/contacts/select.ts` | People extraction from team/about pages and role ranking |
| `src/lib/outreach/*` | Pain-point hypotheses and email templates driven by evidence |
| `src/lib/email/*` | Gmail SMTP (app password) with Resend as the free fallback (`mailer.ts` picks one), recipient allowlist, duplicate-send protection, quality checks |
| `src/lib/scraper/*` | SSRF-safe fetch with retries, cleaning, link and sitemap discovery, robots.txt, CAPTCHA/login detection |

### Failure handling

| Situation | What happens |
|---|---|
| Timeout / connection error / 429 / 5xx | Retry up to 3 times with backoff (same hit) |
| 404 | Skip that URL, choose another source |
| CAPTCHA / bot challenge, login wall, robots.txt disallow | Stop; never bypass. Marked INCOMPLETE with the reason |
| Domain doesn't resolve / private IP | Stop with a clear message |
| Empty / JavaScript-only page | No extraction, so no false qualification. Marked INCOMPLETE if it's the homepage |
| No contact named on the site | Not invented. Email addressed to "<Company> team". You can re-run with `domain \| Name \| Title` |
| Email fails quality checks (no grounded hook, filler phrases, length) | Draft kept and flagged, not auto-sent |
| Email send failure (Gmail or Resend) | Draft kept and error shown; "Send to my inbox" retries |
| Invalid input | Rejected per line with a reason; valid lines still run |

### Security

* Only `GMAIL_USER_EMAIL` can ever receive email. It's a server-side allowlist, and a client-supplied `to` is rejected. Subject header injection is stripped. Duplicate sends within a run are prevented.
* SSRF protection: http(s) only, ports 80/443, no credentials in URLs, DNS-resolved IPs checked against private, loopback, link-local, CGNAT and metadata ranges, **every redirect revalidated**, off-site redirects blocked (except a homepage brand redirect).
* 10 s timeout, 2 MB page cap, honest bot user-agent, robots.txt respected.
* Zod validation on every API body. Per-IP rate limits on research and send.
* The Gmail app password and Resend key live only in server env vars.

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/research` | `{ "domains": "a.com\nb.io \| Jane Doe \| CTO" }` or an array of lines | Streamed NDJSON: `start` → `update`… → `done` with full results · `400` invalid input · `429` rate limit |
| POST | `/api/email/send-to-self` | `{ "subject", "body", "researchId" }` | `{ status: "sent" }` · `403` if `to` ≠ you · `503` Gmail not configured |
| GET | `/api/health` | — | Email configured?, which provider, masked inbox |

## Local development

```bash
npm install
cp .env.example .env.local    # optional: add Gmail (or Resend) to actually send
npm run dev                   # http://localhost:3000
npm test                      # 54 unit + integration tests (fake websites, no network)
npm run typecheck
npx tsx scripts/run.ts linear.app twenty.com   # run the agent from the terminal
```

## Deployment

See **[DEPLOY.md](DEPLOY.md)** for the step-by-step guide (GitHub → email setup → Vercel).

## Known limitations

* Rule-based extraction reads what the site states plainly. Unusual wording can be missed, which shows up as MANUAL REVIEW, not as a wrong QUALIFIED.
* JavaScript-only sites (empty HTML) and sites behind bot protection are marked INCOMPLETE by design.
* Contacts come only from public team/about pages or your input. Many sites don't list leadership, so the email is then addressed to the team.
* The target was under 2 minutes per company. Measured runs on real sites took about 1–8 s per company (shown on each result).

"use client";
import { useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleDashed, ExternalLink, Loader2, Mail, Minus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { buildSelfEmail } from "@/lib/email/compose";
import { STAGES, type ResearchState } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";
import { QualificationBadge, StatusBadge } from "./status";
import { Alert, Badge, Button, CardContent, Card, Input } from "./ui";

type Company = ResearchState;

const duration = (c: Company) => (c.startedAt && c.completedAt ? new Date(c.completedAt).getTime() - new Date(c.startedAt).getTime() : null);
const isRunning = (c: Company) => c.status === "running" || c.status === "queued";

export function CompanyList({ companies, onRerun }: { companies: Company[]; onRerun?: (line: string) => void }) {
  return (
    <div className="space-y-4">
      {companies.map((c) => <CompanyCard key={c.id} c={c} defaultOpen={companies.length === 1} onRerun={onRerun} />)}
    </div>
  );
}

// ── Stage stepper ────────────────────────────────────────────────────────────
type StepState = "done" | "active" | "pending" | "skipped" | "error";

function stepStates(c: Company): Record<string, StepState> {
  const decided = c.qualificationReasons.length > 0;
  const outreach = c.painPoints.length > 0 || c.contactStatus === "none_found" || (decided && c.stage !== "icp_qualification" && (c.qualification === "qualified" || c.qualification === "manual_review") && !!c.emailBody);
  const okPages = c.pages.filter((p) => p.fetchStatus === "ok").length;
  const st: Record<string, StepState> = {
    homepage_fetch: c.hitCount >= 1 ? (c.pages[0]?.fetchStatus === "ok" ? "done" : "error") : "pending",
    content_cleaning: okPages > 0 ? "done" : "pending",
    structured_extraction: c.evidence.length > 0 || decided ? "done" : "pending",
    evidence_validation: c.evidence.length > 0 || decided ? "done" : "pending",
    adaptive_research: c.hitCount > 1 ? "done" : decided ? "skipped" : "pending",
    icp_qualification: decided ? "done" : "pending",
    contact_discovery: c.contact && decided ? "done" : c.contactStatus === "none_found" ? "error" : "pending",
    pain_point_analysis: c.painPoints.length ? "done" : "pending",
    email_drafting: c.emailBody ? "done" : "pending",
    gmail_delivery: c.emailStatus === "sent" ? "done" : c.emailStatus === "failed" ? "error" : c.emailStatus === "not_configured" ? "skipped" : "pending",
  };
  if (!outreach && decided && !isRunning(c)) for (const k of ["contact_discovery", "pain_point_analysis", "email_drafting", "gmail_delivery"]) st[k] = "skipped";
  if (!isRunning(c)) {
    for (const k of Object.keys(st)) if (st[k] === "pending") st[k] = "skipped";
  } else if (STAGES.some((s) => s.key === c.stage)) {
    st[c.stage] = "active";
  }
  return st;
}

function StageStepper({ c }: { c: Company }) {
  const states = stepStates(c);
  const icon = (s: StepState) =>
    s === "done" ? <Check className="h-3 w-3" /> : s === "active" ? <Loader2 className="h-3 w-3 animate-spin" /> : s === "error" ? <X className="h-3 w-3" /> : s === "skipped" ? <Minus className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />;
  const tone = (s: StepState) =>
    s === "done" ? "bg-emerald-500 text-white" : s === "active" ? "bg-brand-600 text-white" : s === "error" ? "bg-rose-500 text-white" : s === "skipped" ? "bg-slate-200 text-slate-500" : "bg-white text-slate-400 border border-slate-300";
  return (
    <ol className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-5 lg:grid-cols-10">
      {STAGES.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5" title={states[s.key]}>
          <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", tone(states[s.key]))}>{icon(states[s.key])}</span>
          <span className={cn("text-[11px] leading-tight", states[s.key] === "active" ? "font-semibold text-brand-700" : "text-slate-600")}>{i + 1}. {s.label}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Company card ─────────────────────────────────────────────────────────────
const TABS = ["Overview", "Qualification", "Evidence", "Contact", "Pain points", "Email", "Research log"] as const;
type Tab = (typeof TABS)[number];

function CompanyCard({ c, defaultOpen, onRerun }: { c: Company; defaultOpen: boolean; onRerun?: (line: string) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<Tab>("Overview");
  const running = isRunning(c);
  const lastPage = c.pages[c.pages.length - 1];

  return (
    <Card>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left" aria-expanded={open}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
            <span className="text-base font-semibold">{c.companyName ?? c.domain}</span>
            <span className="mono text-xs text-slate-500">{c.domain}</span>
            <QualificationBadge q={c.qualification} />
            {c.status !== "completed" && <StatusBadge s={c.status} />}
          </div>
          {c.companyDescription && <p className="mt-1 line-clamp-2 pl-6 text-sm text-slate-600">{c.companyDescription}</p>}
        </div>
        <div className="shrink-0 text-right text-xs text-slate-500">
          <div className="text-sm font-semibold text-slate-800">{c.hitCount}/{c.maxHits} pages</div>
          <div>{running ? "running…" : formatDuration(duration(c))}</div>
        </div>
      </button>
      <div className="space-y-3 border-t border-slate-100 px-5 py-3">
        <StageStepper c={c} />
        {running && (c.nextResearchTarget || lastPage) && (
          <div className="rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-700">
            <span className="font-semibold">{c.nextResearchTarget ? `Fetching hit ${Math.min(c.hitCount + (c.pages.some((p) => p.url === c.nextResearchTarget) ? 0 : 1), 5)}/5: ` : `Hit ${lastPage!.hitNumber}/5: `}</span>
            <span className="mono break-all">{c.nextResearchTarget ?? lastPage!.url}</span>
            <div className="mt-0.5 text-brand-700/80">{c.nextResearchReason ?? lastPage?.selectionReason}</div>
          </div>
        )}
        {!running && c.stopReason && <div className="text-xs text-slate-500"><span className="font-medium text-slate-700">Stop reason:</span> {c.stopReason}</div>}
        {c.status === "escalated" && (
          <Alert tone="amber" title="Stopped: needs a human">
            {c.stopReason ?? c.errors[c.errors.length - 1]} {onRerun && <button className="ml-1 underline" onClick={() => onRerun(c.domain)}>Run again</button>}
          </Alert>
        )}
      </div>
      {open && (
        <div className="border-t border-slate-100">
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3" role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === t ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
                {t}
                {t === "Evidence" && <span className="ml-1 text-xs text-slate-400">{c.evidence.length}</span>}
              </button>
            ))}
          </div>
          <CardContent>
            {tab === "Overview" && <Overview c={c} />}
            {tab === "Qualification" && <Qualification c={c} />}
            {tab === "Evidence" && <EvidenceViewer c={c} />}
            {tab === "Contact" && <ContactTab c={c} onRerun={onRerun} />}
            {tab === "Pain points" && <PainPoints c={c} />}
            {tab === "Email" && <EmailTab c={c} />}
            {tab === "Research log" && <ResearchLog c={c} />}
          </CardContent>
        </div>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm text-slate-800">{children}</div>
    </div>
  );
}
const unknown = <span className="text-slate-400">Unknown</span>;
const yesNo = (v: boolean | null) => (v === null ? unknown : v ? "Yes" : "No");

function Overview({ c }: { c: Company }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Qualification"><QualificationBadge q={c.qualification} /></Field>
        <Field label="Certification">{c.certificationStatus === "certified" ? `Certified: ${c.namedCertifications.join(", ")}` : c.certificationStatus === "not_found" ? "None found (not proof of none)" : unknown}</Field>
        <Field label="Software product / B2B">{yesNo(c.isSaas)} / {yesNo(c.isB2B)}</Field>
        <Field label="Funding stage">{c.fundingStage ?? unknown}</Field>
        <Field label="Open roles listed">{c.openRoleCount ?? unknown}</Field>
        <Field label="Contact">{c.contact ? `${c.contact.name}${c.contact.title ? `, ${c.contact.title}` : ""}` : c.contactStatus === "none_found" ? <span className="text-amber-700">None found</span> : "—"}</Field>
        <Field label="Email">{c.emailStatus === "sent" ? <Badge tone="green">Sent to your inbox</Badge> : c.emailStatus === "none" ? "—" : c.emailStatus.replace(/_/g, " ")}</Field>
        <Field label="Research time">{formatDuration(duration(c))}</Field>
      </div>
      {(c.enterpriseSignals.length > 0 || c.complianceSignals.length > 0 || c.hiringSignals.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-3">
          <SignalList title="Enterprise signals" items={c.enterpriseSignals} />
          <SignalList title="Compliance signals" items={c.complianceSignals} />
          <SignalList title="Hiring signals" items={c.hiringSignals} />
        </div>
      )}
      {c.qualification === "manual_review" && c.emailBody && (
        <Alert tone="amber" title="Manual review: outreach drafted but flagged">B2B SaaS is confirmed and no certification was found, but no stage signal (Series A–C, 5+ roles, enterprise tier) was found. Check before using the email.</Alert>
      )}
      {(c.missingFields.length > 0 || c.errors.length > 0) && (
        <div className="space-y-2">
          {c.missingFields.length > 0 && <Alert tone="amber" title="Unknown fields">{c.missingFields.join(", ").replace(/_/g, " ")}</Alert>}
          {c.errors.length > 0 && <Alert tone="red" title="Issues"><ul className="list-disc pl-4">{c.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Alert>}
        </div>
      )}
    </div>
  );
}

function SignalList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</div>
      {items.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">{items.slice(0, 6).map((s, i) => <li key={i}>{s}</li>)}</ul> : <div className="mt-1 text-sm text-slate-400">None found</div>}
    </div>
  );
}

function Qualification({ c }: { c: Company }) {
  if (!c.qualificationReasons.length) return <div className="text-sm text-slate-500">Qualification has not run yet.</div>;
  const gateName: Record<string, string> = { certification: "Gate 1 · Certification", b2b_saas: "Gate 2 · B2B SaaS", stage: "Gate 3 · Stage", compliance_pressure: "Signal · Compliance pressure (informational)" };
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Each gate is a fixed rule applied to verified evidence. A gate passes only with a quote from the company&apos;s own site; unknown never counts as a pass.</p>
      {c.qualificationReasons.map((r, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{gateName[r.gate] ?? r.gate}</div>
            <Badge tone={r.result === "pass" ? "green" : r.result === "fail" ? "red" : "amber"}>{r.result.toUpperCase()}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-700">{r.explanation}</p>
          {r.evidence.length > 0 && <ul className="mt-2 space-y-1.5">{r.evidence.map((e, j) => <Quote key={j} quote={e.supportingQuote} url={e.sourceUrl} label={`${e.field.replace(/_/g, " ")}: ${e.value}`} />)}</ul>}
        </div>
      ))}
    </div>
  );
}

function Quote({ quote, url, label }: { quote: string; url: string; label?: string }) {
  return (
    <li className="rounded-md border-l-2 border-brand-500 bg-brand-50/40 px-3 py-1.5 text-sm">
      {label && <div className="text-xs font-medium text-slate-500">{label}</div>}
      <div className="whitespace-pre-line italic text-slate-800">&ldquo;{quote}&rdquo;</div>
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="mono inline-flex items-center gap-1 break-all text-xs text-brand-600 hover:underline">{url} <ExternalLink className="h-3 w-3" /></a>
    </li>
  );
}

function EvidenceViewer({ c }: { c: Company }) {
  if (!c.evidence.length) return <div className="text-sm text-slate-500">No verified evidence was collected.</div>;
  const byField = new Map<string, typeof c.evidence>();
  for (const e of c.evidence) byField.set(e.field, [...(byField.get(e.field) ?? []), e]);
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Every claim links to its source page and a verbatim quote that was checked against the fetched page.</p>
      {[...byField.entries()].map(([field, items]) => (
        <div key={field}>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{field.replace(/_/g, " ")} ({items.length})</div>
          <ul className="space-y-1.5">{items.slice(0, 12).map((e, i) => <Quote key={i} quote={e.supportingQuote} url={e.sourceUrl} label={`${e.value} · confidence ${Math.round(e.confidence * 100)}%`} />)}</ul>
        </div>
      ))}
    </div>
  );
}

function ContactTab({ c, onRerun }: { c: Company; onRerun?: (line: string) => void }) {
  const [form, setForm] = useState({ name: "", title: "" });
  if (!c.qualificationReasons.length) return <div className="text-sm text-slate-500">Contact discovery runs after qualification.</div>;
  return (
    <div className="space-y-4">
      {c.contact ? (
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-base font-semibold">{c.contact.name}</div>
          <div className="text-sm text-slate-600">{c.contact.title ?? "Title unknown"}</div>
          <div className="mt-2 text-xs text-slate-500">Source: {c.contact.source === "website" ? "the company's own website" : "provided in the input"} · {c.contact.selectionReason}</div>
          {c.contact.supportingQuote && c.contact.sourceUrl && <ul className="mt-2"><Quote quote={c.contact.supportingQuote} url={c.contact.sourceUrl} /></ul>}
        </div>
      ) : (
        <Alert tone="amber" title="No named contact">
          {c.contactStatus === "none_found" ? "No decision-maker was named on the public pages fetched, so none was invented and the email is addressed to the team." : "Contact discovery only runs for companies that pass the B2B SaaS and certification gates."}
        </Alert>
      )}
      {c.contactCandidates.length > 1 && (
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Other people found (ranked by role relevance)</div>
          <ul className="mt-1 space-y-0.5 text-sm">{c.contactCandidates.slice(1).map((p, i) => <li key={i}>{p.name}: {p.title}</li>)}</ul>
        </div>
      )}
      {onRerun && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim().split(/\s+/).length >= 2) onRerun(`${c.domain} | ${form.name.trim()} | ${form.title.trim()}`);
          }}
          className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3"
        >
          <div className="text-xs font-medium text-slate-600 sm:col-span-3">Know the right person (e.g. from Apollo)? Re-run this company addressed to them:</div>
          <Input placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="Job title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Button type="submit" variant="outline"><RefreshCw className="h-4 w-4" /> Re-run with this contact</Button>
        </form>
      )}
    </div>
  );
}

function PainPoints({ c }: { c: Company }) {
  if (!c.painPoints.length) return <div className="text-sm text-slate-500">Pain points are generated for QUALIFIED companies (and flagged MANUAL REVIEW ones).</div>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {c.painPoints.map((p, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <Badge tone="blue">Hypothesis {i + 1}</Badge>
            <span className="text-xs text-slate-500">confidence {Math.round(p.confidence * 100)}%</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">{p.problem}</p>
          <div className="mt-2 text-xs font-medium uppercase text-slate-400">Evidence</div>
          <p className="text-sm italic text-slate-700">{p.evidence}</p>
          {p.evidenceUrls.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="mono block break-all text-xs text-brand-600 hover:underline">{u}</a>)}
          <div className="mt-2 text-xs font-medium uppercase text-slate-400">Why it matters to {c.contact?.title ?? "the buyer"}</div>
          <p className="text-sm text-slate-700">{p.roleRelevance}</p>
          <div className="mt-2 text-xs font-medium uppercase text-slate-400">Outreach angle</div>
          <p className="text-sm text-slate-700">{p.outreachAngle}</p>
        </div>
      ))}
    </div>
  );
}

function EmailTab({ c }: { c: Company }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  if (!c.emailBody) return <div className="text-sm text-slate-500">{c.qualification === "disqualified" || c.qualification === "incomplete" ? "No email: this company did not qualify." : "The email has not been drafted yet."}</div>;
  async function send() {
    setBusy(true);
    setMsg(null);
    const m = buildSelfEmail(c);
    const res = await fetch("/api/email/send-to-self", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: m.subject, body: m.body, researchId: c.id }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { tone: "green", text: json.duplicate ? "Already sent (duplicate send prevented)." : "Sent to your inbox." } : { tone: "red", text: `${json.error ?? "Send failed"}. The draft below is unchanged.` });
  }
  const sentNow = c.emailStatus === "sent" || msg?.tone === "green";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-600">
          To: <span className="font-medium">your own inbox</span> <span className="text-slate-400">(never the prospect)</span>
          <div className="text-xs text-slate-500">Written for: {c.contact ? `${c.contact.name}${c.contact.title ? `, ${c.contact.title}` : ""}` : `${c.companyName ?? c.domain} team`}</div>
        </div>
        <div className="flex items-center gap-2">
          {sentNow ? <Badge tone="green"><Mail className="h-3 w-3" /> Sent</Badge> : <Badge tone={c.emailStatus === "failed" ? "red" : "amber"}>{c.emailStatus.replace(/_/g, " ")}</Badge>}
          {!sentNow && <Button size="sm" onClick={send} disabled={busy}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />} Send to my inbox</Button>}
        </div>
      </div>
      {c.emailError && !sentNow && <Alert tone="amber"><TriangleAlert className="mr-1 inline h-4 w-4" />{c.emailError}</Alert>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="rounded-lg border border-slate-200">
        <div className="border-b border-slate-100 px-4 py-2 text-sm"><span className="text-slate-400">Subject:</span> <span className="font-medium">{c.emailSubject}</span></div>
        <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-slate-800">{c.emailBody}</pre>
      </div>
    </div>
  );
}

function ResearchLog({ c }: { c: Company }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pages fetched ({c.hitCount}/{c.maxHits} unique hits)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1 pr-3">Hit</th><th className="py-1 pr-3">Page</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3">Why this page</th></tr></thead>
            <tbody>
              {c.pages.map((p) => (
                <tr key={p.url} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3 font-semibold">{p.hitNumber}/5</td>
                  <td className="py-2 pr-3"><div className="text-xs uppercase text-slate-400">{p.pageType}</div><a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="mono break-all text-xs text-brand-600 hover:underline">{p.url}</a></td>
                  <td className="py-2 pr-3 text-xs"><Badge tone={p.fetchStatus === "ok" ? "green" : p.fetchStatus === "not_found" ? "slate" : "red"}>{p.fetchStatus}</Badge><div className="mt-1 text-slate-500">{p.attempts > 1 ? `${p.attempts} attempts · ` : ""}{p.wordCount} words</div></td>
                  <td className="py-2 pr-3 text-xs text-slate-600">{p.selectionReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Agent decisions (audit log)</div>
        <ol className="space-y-1 text-xs">
          {c.log.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="mono shrink-0 text-slate-400">{new Date(l.at).toLocaleTimeString()}</span>
              <span className="shrink-0 font-medium text-slate-700">{l.stage}</span>
              <span className="break-words text-slate-600">{l.event}{summarize(l.details)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function summarize(d: Record<string, unknown>): string {
  const keys = ["url", "hit", "status", "decision", "missing", "reason", "qualification", "summary", "selected", "error"];
  const parts = keys.filter((k) => d[k] !== undefined && d[k] !== null && !(Array.isArray(d[k]) && (d[k] as unknown[]).length === 0)).map((k) => `${k}: ${Array.isArray(d[k]) ? (d[k] as unknown[]).join(", ") : String(d[k])}`);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert, CircleX, FileSearch, Gauge, HelpCircle, Inbox, Layers, Loader2, Mail, Quote, Search, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { loadRuns, saveRun, type StoredRun } from "@/lib/history";
import { parseResearchInput } from "@/lib/security/domain";
import type { ResearchState } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { CompanyList } from "./job-view";
import { Alert, Button, Card, CompanyAvatar, Textarea } from "./ui";

const MAX = 10;
const EXAMPLE = "infisical.com\ntwenty.com\nlinear.app\ndocumenso.com";
const QUICK_ADD = ["infisical.com", "twenty.com", "linear.app", "documenso.com", "tally.so"];

type Rejected = Array<{ input: string; reason: string }>;
interface Config { email: boolean; provider: "gmail" | "resend" | null; selfEmailMasked: string | null; autoSend: boolean }

function Stat({ label, value, icon: Icon, accent }: { label: string; value: number; icon: React.ComponentType<{ className?: string }>; accent: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 shadow-[var(--shadow-card)]">
      <div className={cn("absolute inset-x-0 top-0 h-0.5", accent)} />
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
    </div>
  );
}

const STEPS = [
  { icon: FileSearch, title: "Read the site", text: "Homepage first, then only the pages it still needs: security, careers, pricing, team. Never more than 5." },
  { icon: Quote, title: "Quote the evidence", text: "Every fact is a verbatim sentence from the company's own page, re-checked before it counts." },
  { icon: Gauge, title: "Qualify with fixed rules", text: "Not certified · B2B SaaS · Series A–C signals. Unknown is never treated as a pass." },
  { icon: Mail, title: "Draft & email you", text: "Picks the right person, writes two pain-point hypotheses and a short email, sent only to you." },
];

export function ResearchApp() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; rejected?: Rejected } | null>(null);
  const [rejected, setRejected] = useState<Rejected>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, ResearchState>>({});
  const [config, setConfig] = useState<Config | null>(null);
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const preview = useMemo(() => parseResearchInput(text, MAX), [text]);

  useEffect(() => {
    setRuns(loadRuns());
    fetch("/api/health").then((r) => r.json()).then((j) => setConfig(j.config)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!busy || !started) return;
    const t = setInterval(() => setElapsed(Date.now() - started), 500);
    return () => clearInterval(t);
  }, [busy, started]);

  const stats = useMemo(() => {
    const all = runs.flatMap((r) => r.results);
    const by = (q: string) => all.filter((s) => s.qualification === q).length;
    return { total: all.length, qualified: by("qualified"), disqualified: by("disqualified"), manual: by("manual_review"), incomplete: by("incomplete") };
  }, [runs]);

  function addDomain(d: string) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.some((l) => l.split(/[|,\s]/)[0] === d)) setText([...lines, d].join("\n"));
  }

  async function run(input: string) {
    setError(null);
    const parsed = parseResearchInput(input, MAX);
    if (parsed.entries.length === 0) {
      setError({ message: input.trim() ? "None of the entries are valid company domains." : "Enter at least one company domain.", rejected: parsed.rejected });
      return;
    }
    setBusy(true);
    setOrder([]);
    setStates({});
    setRejected([]);
    setStarted(Date.now());
    setElapsed(0);
    let runId = "";
    let finalResults: ResearchState[] | null = null;
    const latest: Record<string, ResearchState> = {};
    let rej: Rejected = [];
    try {
      const res = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains: input }) });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        setError({ message: json.error ?? `Request failed (HTTP ${res.status})`, rejected: json.details?.rejected });
        setBusy(false);
        return;
      }
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "start") {
            runId = ev.runId;
            rej = ev.rejected;
            setRejected(ev.rejected);
            setConfig(ev.config);
            setOrder(ev.companies.map((c: { id: string }) => c.id));
          } else if (ev.type === "update") {
            latest[ev.state.id] = ev.state;
            setStates((prev) => ({ ...prev, [ev.state.id]: ev.state }));
          } else if (ev.type === "done") {
            finalResults = ev.results;
            for (const s of ev.results as ResearchState[]) latest[s.id] = s;
            setStates({ ...latest });
          } else if (ev.type === "error") {
            setError({ message: ev.error });
          }
        }
      }
    } catch {
      setError({ message: "The connection was interrupted. Results so far are shown; run again to finish." });
    }
    const results = finalResults ?? Object.values(latest);
    if (results.length) {
      saveRun({ id: runId || crypto.randomUUID(), createdAt: new Date().toISOString(), input, rejected: rej, results });
      setRuns(loadRuns());
    }
    setBusy(false);
  }

  const companies = order.map((id) => states[id]).filter(Boolean) as ResearchState[];
  const doneCount = companies.filter((c) => c.status === "completed" || c.status === "escalated").length;
  const pct = order.length ? Math.round((doneCount / order.length) * 100) : 0;
  const summary = {
    qualified: companies.filter((c) => c.qualification === "qualified").length,
    manual: companies.filter((c) => c.qualification === "manual_review").length,
    disqualified: companies.filter((c) => c.qualification === "disqualified").length,
    incomplete: companies.filter((c) => c.qualification === "incomplete").length,
    emailed: companies.filter((c) => c.emailStatus === "sent").length,
  };
  const hasResults = busy || companies.length > 0;

  return (
    <div className="space-y-10">
      {/* Hero + input */}
      <section className="grid items-start gap-8 lg:grid-cols-[1fr_1.15fr]">
        <div className="pt-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white/70 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm">
            <Sparkles className="h-3.5 w-3.5" /> Prospect research for Sprinto
          </span>
          <h1 className="mt-4 text-3xl font-semibold leading-[1.15] tracking-tight text-slate-900 sm:text-4xl">
            Find who&apos;s ready for SOC 2, <span className="bg-gradient-to-r from-brand-600 to-emerald-600 bg-clip-text text-transparent">with receipts.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-600">
            Paste company domains. An agent reads each website, qualifies it against Sprinto&apos;s ICP using sentences quoted from the site, finds the decision-maker, and emails you a personalised draft, in seconds instead of 20 minutes.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2 text-xs font-medium text-slate-700">
            {[
              { icon: Layers, label: "Max 5 pages per company" },
              { icon: Quote, label: "Every claim quoted" },
              { icon: ShieldCheck, label: "Emails only you" },
            ].map((c) => (
              <li key={c.label} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
                <c.icon className="h-3.5 w-3.5 text-brand-600" /> {c.label}
              </li>
            ))}
          </ul>
          {config && !config.email && (
            <div className="mt-6 max-w-xl">
              <Alert tone="amber" title="Email isn't connected">Research still works fully; drafts are shown here but not sent. Add <span className="mono">GMAIL_USER_EMAIL</span> plus <span className="mono">RESEND_API_KEY</span> (or a Gmail app password) on the server.</Alert>
            </div>
          )}
        </div>

        <Card className="relative overflow-hidden shadow-[var(--shadow-lift)]">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-indigo-400 to-emerald-400" />
          <form onSubmit={(e) => { e.preventDefault(); run(text); }} className="space-y-4 p-5 sm:p-6" noValidate>
            <div className="flex items-center justify-between">
              <label htmlFor="domains" className="text-sm font-semibold text-slate-900">Company domains</label>
              <span className={cn("text-xs tabular-nums", preview.entries.length > MAX ? "text-rose-600" : "text-slate-500")}>{preview.entries.length}/{MAX}</span>
            </div>
            <Textarea id="domains" rows={6} className="mono resize-y" placeholder={"one per line, e.g.\n" + EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-slate-500">Try:</span>
              {QUICK_ADD.map((d) => (
                <button key={d} type="button" disabled={busy} onClick={() => addDomain(d)} className="mono rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50">
                  + {d}
                </button>
              ))}
            </div>
            {preview.entries.length > 0 && (
              <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-50 p-2.5">
                {preview.entries.map((e) => (
                  <span key={e.domain} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white py-0.5 pl-0.5 pr-2 text-xs text-slate-700 shadow-sm">
                    <CompanyAvatar name={e.domain} domain={e.domain} size="sm" />
                    <span className="mono">{e.domain}</span>
                    {e.manualContact && <span className="inline-flex items-center gap-0.5 text-brand-700"><UserRound className="h-3 w-3" />{e.manualContact.name}</span>}
                  </span>
                ))}
              </div>
            )}
            {preview.rejected.length > 0 && !error && (
              <ul className="space-y-0.5 text-xs text-amber-800">{preview.rejected.slice(0, 5).map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason} (will be skipped)</li>)}</ul>
            )}
            {error && (
              <Alert tone="red" title={error.message}>
                {error.rejected?.length ? <ul className="mt-1 space-y-0.5 text-xs">{error.rejected.slice(0, 8).map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason}</li>)}</ul> : null}
              </Alert>
            )}
            <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-relaxed text-slate-500">
                Know the right person? Add them: <span className="mono rounded bg-slate-100 px-1 py-0.5 text-slate-700">acme.com | Priya Raman | CTO</span>
              </p>
              <Button type="submit" size="lg" disabled={busy} className="shrink-0">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {busy ? `Researching… ${Math.round(elapsed / 1000)}s` : "Start research"}
              </Button>
            </div>
          </form>
        </Card>
      </section>

      {/* Stats */}
      <section aria-label="Totals in this browser" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Researched" value={stats.total} icon={Layers} accent="bg-brand-500" />
        <Stat label="Qualified" value={stats.qualified} icon={CheckCircle2} accent="bg-emerald-500" />
        <Stat label="Manual review" value={stats.manual} icon={CircleAlert} accent="bg-amber-500" />
        <Stat label="Disqualified" value={stats.disqualified} icon={CircleX} accent="bg-rose-500" />
        <Stat label="Incomplete" value={stats.incomplete} icon={HelpCircle} accent="bg-slate-400" />
      </section>

      {/* Live results */}
      <section ref={resultsRef} className="scroll-mt-24 space-y-4">
        {hasResults ? (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">{busy ? "Researching live" : "Results"}</h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {doneCount}/{order.length} companies done
                  {config?.email ? <> · drafts go to <span className="font-medium text-slate-700">{config.selfEmailMasked}</span> via {config.provider === "resend" ? "Resend" : "Gmail"}</> : ""}
                </p>
              </div>
              {!busy && companies.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs font-medium">
                  <SummaryPill n={summary.qualified} label="qualified" cls="bg-emerald-50 text-emerald-700 border-emerald-200" />
                  <SummaryPill n={summary.manual} label="manual review" cls="bg-amber-50 text-amber-800 border-amber-200" />
                  <SummaryPill n={summary.disqualified} label="disqualified" cls="bg-rose-50 text-rose-700 border-rose-200" />
                  <SummaryPill n={summary.incomplete} label="incomplete" cls="bg-slate-50 text-slate-600 border-slate-200" />
                  <SummaryPill n={summary.emailed} label="emailed" cls="bg-brand-50 text-brand-700 border-brand-200" icon />
                </div>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/70" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Research progress">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-[width] duration-500" style={{ width: `${busy && pct === 0 ? 4 : pct}%` }} />
            </div>
            {rejected.length > 0 && (
              <Alert tone="amber" title={`${rejected.length} input${rejected.length === 1 ? "" : "s"} skipped`}>
                <ul className="space-y-0.5 text-xs">{rejected.map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason}</li>)}</ul>
              </Alert>
            )}
            {busy && companies.length === 0 && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Starting…</div>}
            <CompanyList companies={companies} onRerun={busy ? undefined : (line) => { setText(line); run(line); }} />
          </>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">How it works</h2>
              <ol className="mt-4 grid gap-3 sm:grid-cols-2">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[var(--shadow-card)]">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700 ring-1 ring-brand-100"><s.icon className="h-4 w-4" /></span>
                      <span className="text-xs font-semibold text-slate-400">STEP {i + 1}</span>
                    </div>
                    <div className="mt-3 text-sm font-semibold text-slate-900">{s.title}</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{s.text}</p>
                  </li>
                ))}
              </ol>
            </div>
            <RecentRuns runs={runs} />
          </div>
        )}
      </section>

      {hasResults && runs.length > 0 && <RecentRuns runs={runs} compact />}
    </div>
  );
}

function SummaryPill({ n, label, cls, icon }: { n: number; label: string; cls: string; icon?: boolean }) {
  if (!n) return null;
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1", cls)}>{icon && <Inbox className="h-3 w-3" />}{n} {label}</span>;
}

function RecentRuns({ runs, compact }: { runs: StoredRun[]; compact?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className={cn("font-semibold tracking-tight text-slate-900", compact ? "text-base" : "text-xl")}>Recent research</h2>
        <Link href="/history" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">View all <ArrowRight className="h-3 w-3" /></Link>
      </div>
      <div className={cn("mt-4 grid gap-2", compact && "sm:grid-cols-2 lg:grid-cols-3")}>
        {runs.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center text-sm text-slate-500">
            Nothing yet. Your runs are saved in this browser.
          </div>
        )}
        {runs.slice(0, compact ? 3 : 5).map((r) => {
          const q = r.results.filter((s) => s.qualification === "qualified").length;
          const sent = r.results.filter((s) => s.emailStatus === "sent").length;
          return (
            <Link key={r.id} href={`/history/${r.id}`} className="group flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-3.5 py-3 shadow-[var(--shadow-card)] transition hover:-translate-y-px hover:border-brand-200 hover:shadow-[var(--shadow-lift)]">
              <div className="flex -space-x-2">
                {r.results.slice(0, 3).map((s) => <span key={s.id} className="rounded-xl ring-2 ring-white"><CompanyAvatar name={s.companyName ?? s.domain} domain={s.domain} size="sm" /></span>)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mono truncate text-[13px] text-slate-800">{r.results.map((s) => s.domain).join(", ")}</div>
                <div className="mt-0.5 text-xs text-slate-500">{q} qualified · {sent} emailed · {timeAgo(r.createdAt)}</div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

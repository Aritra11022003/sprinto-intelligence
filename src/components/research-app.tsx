"use client";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Inbox, Loader2, Mail, Quote, Search, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { computeAnalytics, monthLabel } from "@/lib/analytics";
import { loadRuns, saveRun, type StoredRun } from "@/lib/history";
import { parseResearchInput } from "@/lib/security/domain";
import type { ResearchState } from "@/lib/types";
import { cn, formatDuration, timeAgo } from "@/lib/utils";
import { ActivityChart, Legend, PillBars, RunCalendar, SERIES, VERDICT_COLOR, VerdictBubbles } from "./charts";
import { CompanyList } from "./job-view";
import { QualificationBadge } from "./status";
import { Alert, Button, CompanyAvatar, Textarea } from "./ui";

const MAX = 10;
const EXAMPLE = "infisical.com\ntwenty.com\nlinear.app\ndocumenso.com";
const QUICK_ADD = ["infisical.com", "twenty.com", "plausible.io", "linear.app", "cronitor.io"];

type Rejected = Array<{ input: string; reason: string }>;
interface Config { email: boolean; provider: "gmail" | "resend" | null; selfEmailMasked: string | null; autoSend: boolean }

/** Dark bento card. */
const Panel = forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(function Panel({ className, children, ...rest }, ref) {
  return <section ref={ref} className={cn("min-w-0 rounded-[22px] border border-white/[0.07] bg-[#17171c] p-5", className)} {...rest}>{children}</section>;
});
function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-medium tracking-tight text-zinc-100">{children}</h2>
      {right}
    </div>
  );
}
function Delta({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-300/90 px-2 py-0.5 text-[11px] font-semibold text-emerald-950"><ArrowUpRight className="h-3 w-3" />{children}</span>;
}
function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full border border-white/10 p-0.5 text-xs">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={cn("rounded-full px-3 py-1 transition", value === o.value ? "bg-white font-medium text-zinc-900" : "text-zinc-400 hover:text-zinc-100")}>{o.label}</button>
      ))}
    </div>
  );
}

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
  const [range, setRange] = useState<"7" | "14" | "30">("14");
  const resultsRef = useRef<HTMLElement>(null);
  const preview = useMemo(() => parseResearchInput(text, MAX), [text]);
  // "Today" and stored history only exist in the browser: compute after mount so server HTML matches.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), [runs]);
  const a = useMemo(() => computeAnalytics(now ? runs : [], Number(range), now ?? new Date(2026, 0, 1)), [runs, range, now]);

  useEffect(() => {
    setRuns(loadRuns());
    fetch("/api/health").then((r) => r.json()).then((j) => setConfig(j.config)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!busy || !started) return;
    const t = setInterval(() => setElapsed(Date.now() - started), 500);
    return () => clearInterval(t);
  }, [busy, started]);

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
      const res = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify({ domains: input }) });
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
  const monthName = now ? monthLabel(a.calendar.year, a.calendar.month) : "\u00a0";
  const periodTotal = a.daily.reduce((n, d) => n + d.researched, 0);
  const periodQualified = a.daily.reduce((n, d) => n + d.qualified, 0);

  return (
    <div className="space-y-4">
      {/* ── New research ─────────────────────────────────────────────── */}
      <Panel className="relative overflow-hidden p-0">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-amber-300/10 blur-3xl" />
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-zinc-300"><Sparkles className="h-3.5 w-3.5 text-violet-300" /> Prospect research for Sprinto</span>
            <h1 className="mt-4 text-3xl font-semibold leading-[1.15] tracking-tight text-white sm:text-[34px]">
              Find who&apos;s ready for SOC 2, <span className="bg-gradient-to-r from-violet-300 to-amber-200 bg-clip-text text-transparent">with receipts.</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-400">
              Paste company domains. An agent reads each website (max 5 pages), qualifies it against Sprinto&apos;s ICP with sentences quoted from the site, finds the decision-maker, and emails a personalised draft to your own inbox.
            </p>
            <ul className="mt-5 flex flex-wrap gap-2 text-xs text-zinc-300">
              {[
                { icon: Search, label: "Max 5 pages per company" },
                { icon: Quote, label: "Every claim quoted" },
                { icon: ShieldCheck, label: "Emails only you" },
              ].map((c) => (
                <li key={c.label} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5"><c.icon className="h-3.5 w-3.5 text-violet-300" />{c.label}</li>
              ))}
            </ul>
            {config && !config.email && (
              <div className="mt-5 max-w-xl"><Alert tone="amber" title="Email isn't connected">Drafts are shown here but not sent. Add <span className="mono">GMAIL_USER_EMAIL</span> plus <span className="mono">RESEND_API_KEY</span> on the server.</Alert></div>
            )}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); run(text); }} className="min-w-0 space-y-3 rounded-[18px] border border-white/10 bg-black/40 p-4" noValidate>
            <div className="flex items-center justify-between">
              <label htmlFor="domains" className="text-sm font-medium text-zinc-100">Company domains</label>
              <span className={cn("rounded-full border border-white/10 px-2 py-0.5 text-xs tabular-nums", preview.entries.length > MAX ? "text-rose-300" : "text-zinc-400")}>{preview.entries.length}/{MAX}</span>
            </div>
            <Textarea id="domains" rows={5} className="mono resize-y" placeholder={"one per line, e.g.\n" + EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-zinc-500">Try</span>
              {QUICK_ADD.map((d) => (
                <button key={d} type="button" disabled={busy} onClick={() => addDomain(d)} className="mono rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-zinc-300 transition hover:border-violet-300/50 hover:bg-violet-400/10 hover:text-white disabled:opacity-50">+ {d}</button>
              ))}
            </div>
            {preview.entries.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {preview.entries.map((e) => (
                  <span key={e.domain} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-0.5 pl-0.5 pr-2.5 text-xs text-zinc-200">
                    <CompanyAvatar name={e.domain} domain={e.domain} size="sm" />
                    <span className="mono">{e.domain}</span>
                    {e.manualContact && <span className="inline-flex items-center gap-0.5 text-violet-300"><UserRound className="h-3 w-3" />{e.manualContact.name}</span>}
                  </span>
                ))}
              </div>
            )}
            {preview.rejected.length > 0 && !error && (
              <ul className="space-y-0.5 text-xs text-amber-300">{preview.rejected.slice(0, 4).map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason} (will be skipped)</li>)}</ul>
            )}
            {error && (
              <Alert tone="red" title={error.message}>
                {error.rejected?.length ? <ul className="mt-1 space-y-0.5 text-xs">{error.rejected.slice(0, 8).map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason}</li>)}</ul> : null}
              </Alert>
            )}
            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500">Know the right person? <span className="mono text-zinc-300">acme.com | Priya Raman | CTO</span></p>
              <Button type="submit" size="lg" disabled={busy} className="shrink-0">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                {busy ? `Researching… ${Math.round(elapsed / 1000)}s` : "Start research"}
              </Button>
            </div>
          </form>
        </div>
      </Panel>

      {/* ── Live results ─────────────────────────────────────────────── */}
      {hasResults && (
        <Panel ref={resultsRef} className="scroll-mt-24 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-medium tracking-tight text-white">{busy ? "Researching live" : "Results"}</h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                {doneCount}/{order.length} companies done
                {config?.email ? <> · drafts go to <span className="text-zinc-200">{config.selfEmailMasked}</span> via {config.provider === "resend" ? "Resend" : "Gmail"}</> : ""}
              </p>
            </div>
            {!busy && companies.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-xs font-medium">
                {summary.qualified > 0 && <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-emerald-300">{summary.qualified} qualified</span>}
                {summary.manual > 0 && <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-amber-300">{summary.manual} manual review</span>}
                {summary.disqualified > 0 && <span className="rounded-full border border-rose-400/25 bg-rose-400/10 px-2.5 py-1 text-rose-300">{summary.disqualified} disqualified</span>}
                {summary.incomplete > 0 && <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-zinc-300">{summary.incomplete} incomplete</span>}
                {summary.emailed > 0 && <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/25 bg-violet-400/10 px-2.5 py-1 text-violet-200"><Inbox className="h-3 w-3" />{summary.emailed} emailed</span>}
              </div>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Research progress">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-amber-300 transition-[width] duration-500" style={{ width: `${busy && pct === 0 ? 4 : pct}%` }} />
          </div>
          {rejected.length > 0 && (
            <Alert tone="amber" title={`${rejected.length} input${rejected.length === 1 ? "" : "s"} skipped`}>
              <ul className="space-y-0.5 text-xs">{rejected.map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason}</li>)}</ul>
            </Alert>
          )}
          {busy && companies.length === 0 && <div className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Starting…</div>}
          <CompanyList companies={companies} onRerun={busy ? undefined : (line) => { setText(line); run(line); }} />
        </Panel>
      )}

      {/* ── Row 1: activity · calendar · where the agent looked ───────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-5">
          <PanelTitle right={<Segmented value={range} onChange={setRange} options={[{ value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "30", label: "30 days" }]} />}>Research activity</PanelTitle>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
            <div>
              <div className="flex items-center gap-2"><span className="text-4xl font-light tabular-nums tracking-tight text-white">{periodTotal}</span>{periodTotal > 0 && <Delta>{a.totals.runs} runs</Delta>}</div>
              <div className="mt-1 text-xs text-zinc-400">Companies researched</div>
            </div>
            <div>
              <div className="flex items-center gap-2"><span className="text-4xl font-light tabular-nums tracking-tight text-white">{periodQualified}</span>{a.qualifiedRate !== null && <Delta>{Math.round(a.qualifiedRate * 100)}%</Delta>}</div>
              <div className="mt-1 text-xs text-zinc-400">Qualified</div>
            </div>
          </div>
          <div className="mt-3 flex justify-end"><Legend items={[{ label: "Researched", color: SERIES.researched }, { label: "Qualified", color: SERIES.qualified }]} /></div>
          <ActivityChart data={a.daily} />
        </Panel>

        <Panel className="flex flex-col lg:col-span-3">
          <PanelTitle right={<Link href="/history" aria-label="Open history" className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-zinc-300 hover:bg-white/10"><ArrowUpRight className="h-4 w-4" /></Link>}>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-200">{monthName}</span>
          </PanelTitle>
          <RunCalendar calendar={a.calendar} />
          <div className="mt-auto pt-4">
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <div>
                <div className="text-3xl font-light tabular-nums text-white">{a.totals.emailsSent}</div>
                <div className="text-xs text-zinc-400">Drafts emailed to you</div>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-zinc-300"><Mail className="h-4 w-4" /></span>
            </div>
          </div>
        </Panel>

        <Panel className="lg:col-span-4">
          <PanelTitle>Where the agent looked</PanelTitle>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <div className="text-4xl font-light tabular-nums tracking-tight text-white">{a.totals.pages}</div>
              <div className="mt-1 text-xs text-zinc-400">Pages read, all companies</div>
            </div>
            <div className="flex gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-right">
                <div className="text-lg font-light tabular-nums text-white">{a.avgPages !== null ? a.avgPages.toFixed(1) : "–"}<span className="text-xs text-zinc-500">/5</span></div>
                <div className="text-[10px] text-zinc-500">avg per company</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-right">
                <div className="text-lg font-light tabular-nums text-white">{formatDuration(a.avgDurationMs)}</div>
                <div className="text-[10px] text-zinc-500">avg time</div>
              </div>
            </div>
          </div>
          <PillBars items={a.pagesByType} />
        </Panel>
      </div>

      {/* ── Row 2: recent companies · verdict mix · signals ───────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-4">
          <PanelTitle right={<Link href="/history" className="inline-flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10">All runs <ArrowRight className="h-3 w-3" /></Link>}>Recent companies</PanelTitle>
          <div className="space-y-2">
            {a.recent.length === 0 && <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-zinc-500">No research yet. Your runs are saved in this browser.</div>}
            {a.recent.map((r) => (
              <Link key={r.id} href={`/history/${r.runId}`} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2 pr-2.5 transition hover:border-white/15 hover:bg-white/[0.06]">
                <CompanyAvatar name={r.name} domain={r.domain} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-100">{r.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5"><QualificationBadge q={r.qualification} /><span className="truncate text-[11px] text-zinc-500">{r.contact ?? timeAgo(r.at)}</span></div>
                </div>
                <span className="flex h-10 min-w-12 flex-col items-center justify-center rounded-xl border border-white/10 bg-black/30 px-2 text-sm tabular-nums text-zinc-100">{r.pages}<span className="text-[9px] text-zinc-500">pages</span></span>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel className="lg:col-span-3">
          <PanelTitle>Verdict mix</PanelTitle>
          <VerdictBubbles items={a.verdicts} />
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-400">
            {a.verdicts.map((v) => <span key={v.key} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: VERDICT_COLOR[v.key] }} />{v.label} <span className="ml-auto tabular-nums text-zinc-200">{v.count}</span></span>)}
          </div>
        </Panel>

        <Panel className="relative overflow-hidden lg:col-span-5">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1/2 opacity-60" style={{ backgroundImage: "radial-gradient(rgba(196,181,253,0.35) 1.2px, transparent 1.3px)", backgroundSize: "10px 10px", maskImage: "radial-gradient(ellipse at 40% 55%, black 20%, transparent 70%)", WebkitMaskImage: "radial-gradient(ellipse at 40% 55%, black 20%, transparent 70%)" }} />
          <div className="relative grid gap-5 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col">
              <h2 className="text-[15px] font-medium tracking-tight text-zinc-100">Evidence collected</h2>
              <div className="mt-auto pt-8">
                <div className="text-4xl font-light tabular-nums tracking-tight text-white">{a.totals.evidence}</div>
                <div className="mt-1 text-xs text-zinc-400">Verbatim quotes behind every verdict</div>
                <div className="mt-4 text-xs text-zinc-500">Named contact on {a.namedContactRate !== null ? `${Math.round(a.namedContactRate * 100)}%` : "–"} of drafted emails</div>
              </div>
            </div>
            <div className="min-w-0">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Top signals</div>
              <div className="space-y-1.5">
                {a.topSignals.length === 0 && <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-zinc-500">Signals like “Certified: SOC 2” or “Enterprise plan” will rank here.</div>}
                {a.topSignals.map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-black/30 px-3 py-2 text-xs">
                    <span className="truncate text-zinc-200" title={s.label}>{s.label}</span>
                    <span className="tabular-nums text-zinc-400">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleX, HelpCircle, Layers, Loader2, Search } from "lucide-react";
import { loadRuns, saveRun, type StoredRun } from "@/lib/history";
import { parseResearchInput } from "@/lib/security/domain";
import type { ResearchState } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { CompanyList } from "./job-view";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Textarea } from "./ui";

const MAX = 10;
const EXAMPLE = "infisical.com\ntwenty.com\nlinear.app\ndocumenso.com";

type Rejected = Array<{ input: string; reason: string }>;
interface Config { gmail: boolean; selfEmailMasked: string | null; autoSend: boolean }

function Stat({ label, value, icon, tone }: { label: string; value: number | string; icon: React.ReactNode; tone: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <div className={`rounded-lg p-2 ${tone}`}>{icon}</div>
        <div>
          <div className="text-2xl font-semibold leading-none">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{label}</div>
        </div>
      </CardContent>
    </Card>
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Prospect research for Sprinto</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Paste company domains. For each one an agent reads the homepage, decides which other pages it needs (max 5 per company), qualifies it against Sprinto&apos;s ICP using evidence quoted from the site, finds a decision-maker, writes two pain-point hypotheses and a personalised email, and sends that email to <strong>your own inbox</strong>.
        </p>
      </div>

      {config && !config.gmail && (
        <Alert tone="amber" title="Gmail is not connected">Research works fully; emails are drafted and shown here but not sent. Set GMAIL_USER_EMAIL and GMAIL_APP_PASSWORD on the server to deliver them.</Alert>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Researched (this browser)" value={stats.total} icon={<Layers className="h-5 w-5 text-brand-600" />} tone="bg-brand-50" />
        <Stat label="Qualified" value={stats.qualified} icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} tone="bg-emerald-50" />
        <Stat label="Disqualified" value={stats.disqualified} icon={<CircleX className="h-5 w-5 text-rose-600" />} tone="bg-rose-50" />
        <Stat label="Manual review" value={stats.manual} icon={<CircleAlert className="h-5 w-5 text-amber-600" />} tone="bg-amber-50" />
        <Stat label="Incomplete" value={stats.incomplete} icon={<HelpCircle className="h-5 w-5 text-slate-600" />} tone="bg-slate-100" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>New research</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); run(text); }} className="space-y-3" noValidate>
              <label htmlFor="domains" className="text-sm font-medium text-slate-700">Company domains <span className="font-normal text-slate-500">(one per line, up to {MAX})</span></label>
              <Textarea id="domains" rows={6} className="mono" placeholder={EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
              <div className="text-xs text-slate-500">
                Optional known contact per line: <span className="mono">domain | Full Name | Title</span>. Each company gets at most <strong>5 unique page fetches</strong> (homepage = hit 1), chosen automatically.
              </div>
              {preview.entries.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {preview.entries.map((e) => <span key={e.domain} className="mono rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{e.domain}{e.manualContact ? ` → ${e.manualContact.name}` : ""}</span>)}
                </div>
              )}
              {preview.rejected.length > 0 && !error && (
                <ul className="space-y-0.5 text-xs text-amber-800">{preview.rejected.slice(0, 6).map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason} (will be skipped)</li>)}</ul>
              )}
              {error && (
                <Alert tone="red" title={error.message}>
                  {error.rejected?.length ? <ul className="mt-1 space-y-0.5 text-xs">{error.rejected.slice(0, 8).map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason}</li>)}</ul> : null}
                </Alert>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="lg" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {busy ? `Researching… ${Math.round(elapsed / 1000)}s` : "Start research"}
                </Button>
                {!text && !busy && <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setText(EXAMPLE)}>Use example input</button>}
              </div>
            </form>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent research</CardTitle>
            <Link href="/history" className="text-xs text-brand-600 hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.length === 0 && <div className="text-sm text-slate-500">No research yet in this browser.</div>}
            {runs.slice(0, 5).map((r) => (
              <Link key={r.id} href={`/history/${r.id}`} className="block rounded-lg border border-slate-100 px-3 py-2 hover:border-brand-100 hover:bg-brand-50/40">
                <div className="mono truncate text-sm">{r.results.map((s) => s.domain).join(", ")}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {r.results.filter((s) => s.qualification === "qualified").length} qualified · {r.results.filter((s) => s.emailStatus === "sent").length} emailed · {timeAgo(r.createdAt)}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div ref={resultsRef} className="scroll-mt-20 space-y-4">
        {(busy || companies.length > 0) && (
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Live research</h2>
            <span className="text-sm text-slate-500">{doneCount}/{order.length} done{config?.gmail ? ` · emails go to ${config.selfEmailMasked}` : ""}</span>
          </div>
        )}
        {rejected.length > 0 && (
          <Alert tone="amber" title={`${rejected.length} input(s) skipped`}>
            <ul className="space-y-0.5 text-xs">{rejected.map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason}</li>)}</ul>
          </Alert>
        )}
        {busy && companies.length === 0 && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Starting…</div>}
        <CompanyList companies={companies} onRerun={busy ? undefined : (line) => { setText(line); run(line); }} />
      </div>
    </div>
  );
}

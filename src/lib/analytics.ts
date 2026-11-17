// Dashboard metrics computed from the research runs stored in this browser. Pure functions.
import type { StoredRun } from "@/lib/history";
import type { PageType, Qualification, ResearchState } from "@/lib/types";

export interface DayPoint { date: string; label: string; researched: number; qualified: number }
export interface Analytics {
  totals: { researched: number; qualified: number; manual: number; disqualified: number; incomplete: number; emailsSent: number; evidence: number; pages: number; runs: number };
  qualifiedRate: number | null;
  namedContactRate: number | null;
  avgPages: number | null;
  avgDurationMs: number | null;
  daily: DayPoint[];
  calendar: { year: number; month: number; days: Array<{ day: number; runs: number; date: string }> };
  pagesByType: Array<{ type: PageType; label: string; count: number }>;
  verdicts: Array<{ key: Qualification; label: string; count: number; share: number }>;
  topSignals: Array<{ label: string; count: number }>;
  recent: Array<{ id: string; runId: string; domain: string; name: string; qualification: Qualification; pages: number; contact: string | null; at: string }>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Locale-independent label ("4 Nov") so server and browser render identical text. */
export const dayLabel = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const monthLabel = (year: number, month: number) => `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month]} ${year}`;

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const PAGE_LABEL: Partial<Record<PageType, string>> = {
  homepage: "Home", security: "Security", careers: "Careers", pricing: "Pricing", team: "Team", about: "About", customers: "Customers", product: "Product",
};

export function computeAnalytics(runs: StoredRun[], days = 14, now = new Date()): Analytics {
  const all: Array<{ s: ResearchState; run: StoredRun }> = runs.flatMap((run) => run.results.map((s) => ({ s, run })));
  const count = (q: Qualification) => all.filter(({ s }) => s.qualification === q).length;
  const researched = all.length;
  const qualified = count("qualified");
  const drafted = all.filter(({ s }) => !!s.emailBody);
  const durations = all.map(({ s }) => (s.startedAt && s.completedAt ? new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime() : null)).filter((x): x is number => x !== null);
  const pages = all.reduce((n, { s }) => n + s.hitCount, 0);

  // Daily series for the last `days` days (oldest → newest).
  const byDay = new Map<string, { researched: number; qualified: number }>();
  for (const { s, run } of all) {
    const k = dayKey(new Date(run.createdAt));
    const v = byDay.get(k) ?? { researched: 0, qualified: 0 };
    v.researched += 1;
    if (s.qualification === "qualified") v.qualified += 1;
    byDay.set(k, v);
  }
  const daily: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    daily.push({ date: k, label: dayLabel(d), ...(byDay.get(k) ?? { researched: 0, qualified: 0 }) });
  }

  // Calendar for the current month: number of runs per day.
  const year = now.getFullYear();
  const month = now.getMonth();
  const runsPerDay = new Map<string, number>();
  for (const run of runs) runsPerDay.set(dayKey(new Date(run.createdAt)), (runsPerDay.get(dayKey(new Date(run.createdAt))) ?? 0) + 1);
  const dim = new Date(year, month + 1, 0).getDate();
  const calendarDays = Array.from({ length: dim }, (_, i) => {
    const date = dayKey(new Date(year, month, i + 1));
    return { day: i + 1, runs: runsPerDay.get(date) ?? 0, date };
  });

  // Where the agent looked: page fetches by type (fixed order so colours/positions never shift).
  const typeOrder: PageType[] = ["homepage", "security", "careers", "pricing", "team", "about", "customers"];
  const typeCount = new Map<PageType, number>();
  for (const { s } of all) for (const p of s.pages) typeCount.set(p.pageType, (typeCount.get(p.pageType) ?? 0) + 1);
  const pagesByType = typeOrder.map((type) => ({ type, label: PAGE_LABEL[type] ?? type, count: typeCount.get(type) ?? 0 }));

  const verdictDefs: Array<{ key: Qualification; label: string }> = [
    { key: "qualified", label: "Qualified" },
    { key: "manual_review", label: "Manual review" },
    { key: "disqualified", label: "Disqualified" },
    { key: "incomplete", label: "Incomplete" },
  ];
  const verdicts = verdictDefs.map((v) => ({ ...v, count: count(v.key), share: researched ? count(v.key) / researched : 0 }));

  // Most common signals behind decisions (certifications, enterprise and compliance signals).
  const signalCount = new Map<string, number>();
  for (const { s } of all) {
    const seen = new Set<string>();
    for (const e of s.evidence) {
      if (!["certification", "enterprise_signal", "compliance_signal", "funding_stage", "late_stage_signal"].includes(e.field)) continue;
      const label = e.field === "certification" ? `Certified: ${e.value}` : e.field === "funding_stage" ? `Funding: ${e.value}` : e.value.replace(/^Hiring for security\/compliance:.*/i, "Hiring for security / compliance");
      if (seen.has(label)) continue;
      seen.add(label);
      signalCount.set(label, (signalCount.get(label) ?? 0) + 1);
    }
  }
  const topSignals = [...signalCount.entries()].map(([label, c]) => ({ label, count: c })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 6);

  const recent = [...all]
    .sort((a, b) => (b.s.completedAt ?? b.run.createdAt).localeCompare(a.s.completedAt ?? a.run.createdAt))
    .filter(({ s }, i, arr) => arr.findIndex((x) => x.s.domain === s.domain) === i)
    .slice(0, 6)
    .map(({ s, run }) => ({ id: s.id, runId: run.id, domain: s.domain, name: s.companyName ?? s.domain, qualification: s.qualification, pages: s.hitCount, contact: s.contact?.name ?? null, at: s.completedAt ?? run.createdAt }));

  return {
    totals: { researched, qualified, manual: count("manual_review"), disqualified: count("disqualified"), incomplete: count("incomplete"), emailsSent: all.filter(({ s }) => s.emailStatus === "sent").length, evidence: all.reduce((n, { s }) => n + s.evidence.length, 0), pages, runs: runs.length },
    qualifiedRate: researched ? qualified / researched : null,
    namedContactRate: drafted.length ? drafted.filter(({ s }) => !!s.contact).length / drafted.length : null,
    avgPages: researched ? pages / researched : null,
    avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    daily,
    calendar: { year, month, days: calendarDays },
    pagesByType,
    verdicts,
    topSignals,
    recent,
  };
}

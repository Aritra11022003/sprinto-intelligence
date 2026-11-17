// Research history, kept in this browser (localStorage). Every access is guarded: private
// windows or blocked storage simply mean no history, never a broken page.
import type { ResearchState } from "@/lib/types";

export interface StoredRun {
  id: string;
  createdAt: string;
  input: string;
  rejected: Array<{ input: string; reason: string }>;
  results: ResearchState[];
}

const KEY = "sprinto-intelligence:runs:v1";
const MAX_RUNS = 25;

export function loadRuns(): StoredRun[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const runs = raw ? (JSON.parse(raw) as StoredRun[]) : [];
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

export function saveRun(run: StoredRun): void {
  try {
    const runs = [run, ...loadRuns().filter((r) => r.id !== run.id)].slice(0, MAX_RUNS);
    // Logs are the bulkiest part; keep the latest 80 entries per company.
    const slim = runs.map((r) => ({ ...r, results: r.results.map((s) => ({ ...s, log: s.log.slice(-80) })) }));
    window.localStorage.setItem(KEY, JSON.stringify(slim));
  } catch {
    /* storage full or blocked: history is a convenience only */
  }
}

export function getRun(id: string): StoredRun | null {
  return loadRuns().find((r) => r.id === id) ?? null;
}

export function clearRuns(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

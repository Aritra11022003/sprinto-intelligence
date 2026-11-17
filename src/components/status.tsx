import { Badge } from "./ui";

const Q: Record<string, { tone: "green" | "red" | "amber" | "slate" | "blue"; label: string; dot: string }> = {
  qualified: { tone: "green", label: "QUALIFIED", dot: "bg-emerald-500" },
  disqualified: { tone: "red", label: "DISQUALIFIED", dot: "bg-rose-500" },
  manual_review: { tone: "amber", label: "MANUAL REVIEW", dot: "bg-amber-500" },
  incomplete: { tone: "slate", label: "INCOMPLETE", dot: "bg-slate-400" },
};

export function QualificationBadge({ q }: { q: string }) {
  const v = Q[q];
  if (!v) {
    return (
      <Badge tone="blue">
        <span className="h-1.5 w-1.5 animate-[var(--animate-pulse-soft)] rounded-full bg-violet-300" /> RESEARCHING
      </Badge>
    );
  }
  return (
    <Badge tone={v.tone}>
      <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} /> {v.label}
    </Badge>
  );
}

export function StatusBadge({ s }: { s: string }) {
  const map: Record<string, { tone: "green" | "red" | "amber" | "slate" | "blue"; label: string }> = {
    queued: { tone: "slate", label: "Queued" },
    running: { tone: "blue", label: "Running" },
    completed: { tone: "green", label: "Completed" },
    escalated: { tone: "amber", label: "Needs a human" },
  };
  const v = map[s] ?? { tone: "slate" as const, label: s };
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

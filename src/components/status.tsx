import { Badge } from "./ui";

export function QualificationBadge({ q }: { q: string }) {
  switch (q) {
    case "qualified": return <Badge tone="green">QUALIFIED</Badge>;
    case "disqualified": return <Badge tone="red">DISQUALIFIED</Badge>;
    case "manual_review": return <Badge tone="amber">MANUAL REVIEW</Badge>;
    case "incomplete": return <Badge tone="slate">INCOMPLETE</Badge>;
    default: return <Badge tone="blue">RESEARCHING</Badge>;
  }
}

export function StatusBadge({ s }: { s: string }) {
  const map: Record<string, { tone: "green" | "red" | "amber" | "slate" | "blue"; label: string }> = {
    queued: { tone: "slate", label: "Queued" },
    running: { tone: "blue", label: "Running" },
    completed: { tone: "green", label: "Completed" },
    completed_with_errors: { tone: "amber", label: "Completed with errors" },
    failed: { tone: "red", label: "Failed" },
    escalated: { tone: "amber", label: "Escalated" },
  };
  const v = map[s] ?? { tone: "slate" as const, label: s };
  return <Badge tone={v.tone}>{v.label}</Badge>;
}

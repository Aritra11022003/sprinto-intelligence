"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { clearRuns, loadRuns, type StoredRun } from "@/lib/history";
import { timeAgo } from "@/lib/utils";

export default function HistoryPage() {
  const [runs, setRuns] = useState<StoredRun[] | null>(null);
  useEffect(() => setRuns(loadRuns()), []);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Research history</h1>
        {runs && runs.length > 0 && <Button variant="outline" size="sm" onClick={() => { clearRuns(); setRuns([]); }}>Clear history</Button>}
      </div>
      <Alert tone="blue">History is stored in this browser only.</Alert>
      <Card>
        <CardHeader><CardTitle>All runs</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] text-left text-xs uppercase text-zinc-400">
              <tr><th className="px-5 py-2">Companies</th><th className="px-5 py-2">Qualified</th><th className="px-5 py-2">Manual review</th><th className="px-5 py-2">Emailed</th><th className="px-5 py-2">When</th></tr>
            </thead>
            <tbody>
              {runs?.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.06] hover:bg-white/[0.04]">
                  <td className="px-5 py-2"><Link className="mono text-violet-300 hover:underline" href={`/history/${r.id}`} title={r.results.map((s) => s.domain).join(", ")}>{r.results.slice(0, 3).map((s) => s.domain).join(", ")}{r.results.length > 3 ? ` +${r.results.length - 3} more` : ""}</Link></td>
                  <td className="px-5 py-2">{r.results.filter((s) => s.qualification === "qualified").length}</td>
                  <td className="px-5 py-2">{r.results.filter((s) => s.qualification === "manual_review").length}</td>
                  <td className="px-5 py-2">{r.results.filter((s) => s.emailStatus === "sent").length}</td>
                  <td className="px-5 py-2 text-zinc-400">{timeAgo(r.createdAt)}</td>
                </tr>
              ))}
              {runs?.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-zinc-400">No research yet. <Link href="/" className="text-violet-300 hover:underline">Start one</Link>.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

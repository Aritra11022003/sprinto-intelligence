"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CompanyList } from "@/components/job-view";
import { Alert } from "@/components/ui";
import { getRun, type StoredRun } from "@/lib/history";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [run, setRun] = useState<StoredRun | null | undefined>(undefined);
  useEffect(() => setRun(getRun(id)), [id]);
  return (
    <div className="space-y-6">
      <Link href="/history" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"><ArrowLeft className="h-4 w-4" /> History</Link>
      {run === null && <Alert tone="amber" title="Run not found">It may have been cleared, or it was created in another browser.</Alert>}
      {run && (
        <>
          <div>
            <h1 className="text-2xl font-semibold">Research run</h1>
            <p className="text-sm text-zinc-400">{new Date(run.createdAt).toLocaleString()} · {run.results.length} companies</p>
          </div>
          {run.rejected.length > 0 && <Alert tone="amber" title="Skipped inputs"><ul className="text-xs">{run.rejected.map((r, i) => <li key={i}><span className="mono">{r.input}</span>: {r.reason}</li>)}</ul></Alert>}
          <CompanyList companies={run.results} />
        </>
      )}
    </div>
  );
}

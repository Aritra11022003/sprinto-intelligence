// POST /api/research - research a list of domains and stream live progress (NDJSON).
// Events: {type:"start", companies, rejected} → {type:"update", state} … → {type:"done", results}
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { configStatus, productionDeps, runBatch } from "@/lib/research";
import { parseResearchInput } from "@/lib/security/domain";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import type { ResearchState } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ domains: z.union([z.string().max(20_000), z.array(z.string().max(500)).max(200)]) });

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ error, ...(details !== undefined ? { details } : {}) }, { status });
}

export async function POST(req: Request) {
  const rl = rateLimit(`research:${clientKey(req.headers)}`, 6, 60_000);
  if (!rl.ok) return jsonError(429, `Too many research requests. Try again in ${rl.retryAfterSec}s.`);

  const text = await req.text();
  if (text.length > 100_000) return jsonError(413, "Request body too large");
  let json: unknown;
  try {
    json = text.trim() ? JSON.parse(text) : {};
  } catch {
    return jsonError(400, "Request body must be valid JSON");
  }
  const body = Body.safeParse(json);
  if (!body.success) return jsonError(400, 'Provide "domains" as a string (one per line) or an array of strings.');

  const max = Math.max(1, Math.min(25, Number(process.env.MAX_DOMAINS_PER_JOB) || 10));
  const { entries, rejected } = parseResearchInput(body.data.domains, max);
  if (entries.length === 0) {
    return jsonError(400, rejected.length ? "None of the entries are valid company domains." : "Enter at least one company domain.", { rejected });
  }

  const ids = entries.map(() => randomUUID());
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* client disconnected: keep researching so the Gmail step still completes */
        }
      };
      send({ type: "start", runId: randomUUID(), startedAt: new Date().toISOString(), companies: entries.map((e, i) => ({ id: ids[i], domain: e.domain, manualContact: e.manualContact })), rejected, config: configStatus() });
      // Throttle per-company updates to keep the stream light.
      const last = new Map<string, number>();
      const onUpdate = (s: ResearchState) => {
        const now = Date.now();
        if (s.status === "running" && now - (last.get(s.id) ?? 0) < 250) return;
        last.set(s.id, now);
        send({ type: "update", state: s });
      };
      try {
        const results = await runBatch(entries, productionDeps(), onUpdate, ids);
        send({ type: "done", results });
      } catch (err) {
        send({ type: "error", error: (err as Error).message });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

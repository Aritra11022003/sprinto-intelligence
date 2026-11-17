// /api/research - research a list of company domains.
//
// Input (lenient, for automated tests): POST JSON {domains: "a.com\nb.io"} or {domains: [...]},
// {domain: "a.com"}, {urls|websites|companies|input: ...}, a bare array, objects like
// {domain, contact_name, contact_title}, a text/plain body, or GET /api/research?domain=a.com.
//
// Output: one JSON object {ok, count, results: [...]} by default.
// Live progress (NDJSON stream) only when asked: ?stream=1 or "Accept: application/x-ndjson".
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { normalizeResearchRequest, summarize } from "@/lib/api-format";
import { configStatus, productionDeps, runBatch } from "@/lib/research";
import { parseResearchInput, type ResearchEntry } from "@/lib/security/domain";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import type { ResearchState } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const FORMAT_HELP = 'Send company domains, e.g. {"domains": ["acme.com", "beta.io"]} or {"domain": "acme.com"}. Optional contact per line: "acme.com | Jane Doe | CTO".';

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details !== undefined ? { details } : {}) }, { status });
}

const maxDomains = () => Math.max(1, Math.min(25, Number(process.env.MAX_DOMAINS_PER_JOB) || 10));

async function handle(req: Request, lines: string[] | null) {
  if (lines === null) return jsonError(400, `No company domains found in the request. ${FORMAT_HELP}`);
  const { entries, rejected } = parseResearchInput(lines, maxDomains());
  if (entries.length === 0) {
    return jsonError(400, rejected.length ? "None of the entries are valid company domains." : "Enter at least one company domain.", { rejected, help: FORMAT_HELP });
  }
  // Rate-limit only requests that will actually start research (invalid input is cheap and gets its real error).
  const rl = rateLimit(`research:${clientKey(req.headers)}`, 20, 60_000);
  if (!rl.ok) return jsonError(429, `Too many research requests. Try again in ${rl.retryAfterSec}s.`);

  const url = new URL(req.url);
  const wantsStream = url.searchParams.get("stream") === "1" || (req.headers.get("accept") ?? "").includes("application/x-ndjson");
  return wantsStream ? streamResponse(entries, rejected) : jsonResponse(entries, rejected, url.searchParams.get("full") === "1");
}

async function jsonResponse(entries: ResearchEntry[], rejected: Array<{ input: string; reason: string }>, full: boolean) {
  const started = Date.now();
  const results = await runBatch(entries, productionDeps(), () => undefined);
  return NextResponse.json({
    ok: true,
    count: results.length,
    duration_ms: Date.now() - started,
    counts: {
      qualified: results.filter((r) => r.qualification === "qualified").length,
      manual_review: results.filter((r) => r.qualification === "manual_review").length,
      disqualified: results.filter((r) => r.qualification === "disqualified").length,
      incomplete: results.filter((r) => r.qualification === "incomplete").length,
      emails_sent: results.filter((r) => r.emailStatus === "sent").length,
    },
    rejected,
    email: configStatus(),
    results: results.map(summarize),
    ...(full ? { full_results: results } : {}),
  });
}

function streamResponse(entries: ResearchEntry[], rejected: Array<{ input: string; reason: string }>) {
  const ids = entries.map(() => randomUUID());
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* client disconnected: keep researching so the email step still completes */
        }
      };
      send({ type: "start", runId: randomUUID(), startedAt: new Date().toISOString(), companies: entries.map((e, i) => ({ id: ids[i], domain: e.domain, manualContact: e.manualContact })), rejected, config: configStatus() });
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

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > 100_000) return jsonError(413, "Request body too large");
  if (!text.trim()) return jsonError(400, `Request body is empty. ${FORMAT_HELP}`);
  const type = req.headers.get("content-type") ?? "";
  let body: unknown;
  if (type.includes("application/x-www-form-urlencoded")) {
    body = Object.fromEntries(new URLSearchParams(text));
  } else {
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: accept a plain-text list of domains, but reject things that are clearly broken JSON.
      if (/^\s*[{[]/.test(text)) return jsonError(400, `Request body must be valid JSON. ${FORMAT_HELP}`);
      body = text;
    }
  }
  return handle(req, normalizeResearchRequest(body));
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const values = [...sp.getAll("domain"), ...sp.getAll("domains"), ...sp.getAll("url"), ...sp.getAll("urls")].flatMap((v) => v.split(/[\n,]/));
  if (values.length === 0) return jsonError(400, `Add ?domain=acme.com (repeatable). ${FORMAT_HELP}`);
  return handle(req, values);
}

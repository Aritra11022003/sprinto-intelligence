// Runs research for a batch of entries with bounded concurrency.
import { randomUUID } from "node:crypto";
import { runCompanyResearch, type AgentDeps } from "@/lib/agent/graph";
import { configuredSelfAddress } from "@/lib/email/gmail";
import { getMailer } from "@/lib/email/mailer";
import { defaultFetchDeps } from "@/lib/scraper/fetch";
import type { ResearchEntry } from "@/lib/security/domain";
import { initialState, type ResearchState } from "@/lib/types";

export const COMPANY_CONCURRENCY = 5;

export function productionDeps(): Omit<AgentDeps, "onUpdate"> {
  return {
    fetchDeps: defaultFetchDeps,
    mailer: getMailer(),
    selfEmail: configuredSelfAddress(),
    autoSend: process.env.AUTO_SEND_TO_SELF !== "false",
    now: () => new Date(),
  };
}

export async function runBatch(entries: ResearchEntry[], deps: Omit<AgentDeps, "onUpdate">, onUpdate: (s: ResearchState) => void, ids?: string[]): Promise<ResearchState[]> {
  const states = entries.map((e, i) => initialState({ id: ids?.[i] ?? randomUUID(), domain: e.domain, manualContact: e.manualContact }));
  const results: ResearchState[] = new Array(states.length);
  const queue = states.map((s, i) => ({ s, i }));
  await Promise.all(
    Array.from({ length: Math.min(COMPANY_CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        results[item.i] = await runCompanyResearch(item.s, { ...deps, onUpdate });
      }
    }),
  );
  return results;
}

export function configStatus() {
  const e = configuredSelfAddress();
  return {
    email: !!getMailer(),
    provider: getMailer()?.provider ?? null,
    selfEmailMasked: e ? `${e.split("@")[0].slice(0, 2)}•••@${e.split("@")[1]}` : null,
    autoSend: process.env.AUTO_SEND_TO_SELF !== "false",
  };
}

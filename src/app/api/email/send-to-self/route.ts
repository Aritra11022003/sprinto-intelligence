// POST /api/email/send-to-self - (re)send a draft to the configured user's own inbox.
// The recipient is never accepted from the client: it is always GMAIL_USER_EMAIL.
import { NextResponse } from "next/server";
import { z } from "zod";
import { deliverToSelf } from "@/lib/email/deliver";
import { configuredSelfAddress } from "@/lib/email/gmail";
import { getMailer } from "@/lib/email/mailer";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(10_000),
  to: z.string().optional(),
  /** The research result id: a draft from one run is sent at most once. */
  researchId: z.string().trim().min(1).max(100),
});

export async function POST(req: Request) {
  const rl = rateLimit(`send:${clientKey(req.headers)}`, 5, 60_000);
  if (!rl.ok) return NextResponse.json({ error: `Too many send attempts. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Provide a subject, body and researchId." }, { status: 400 });

  const self = configuredSelfAddress();
  const mailer = getMailer();
  if (!self || !mailer) return NextResponse.json({ error: "Email is not configured on the server (set GMAIL_USER_EMAIL plus GMAIL_APP_PASSWORD or RESEND_API_KEY). The draft is still shown." }, { status: 503 });
  if (parsed.data.to && parsed.data.to.trim().toLowerCase() !== self) return NextResponse.json({ error: "Emails can only be sent to the configured user's own inbox." }, { status: 403 });

  const result = await deliverToSelf(mailer, self, { subject: parsed.data.subject, body: parsed.data.body }, `manual:${parsed.data.researchId}`);
  if (result.status !== "sent") return NextResponse.json({ error: result.error ?? "Send failed", draftPreserved: true }, { status: 502 });
  return NextResponse.json({ status: "sent", messageId: result.messageId, duplicate: result.duplicate ?? false });
}

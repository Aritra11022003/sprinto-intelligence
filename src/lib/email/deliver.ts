// Delivery of a draft to the user's own inbox, with duplicate-send protection.
// A failed send never deletes the draft: the draft lives in the research result.
import { createHash } from "node:crypto";
import { assertRecipientAllowed, type Mailer } from "./gmail";
export { buildSelfEmail } from "./compose";

export interface DeliveryResult { status: "sent" | "failed"; messageId: string | null; error: string | null; duplicate?: boolean }

// Best-effort idempotency per server instance: the same draft is never sent twice.
const sent = new Map<string, string>();

/** Duplicate protection is per research run (`scope`): re-running a company may send again; double-sending one run may not. */
export function sendKey(scope: string, subject: string, body: string, recipient: string): string {
  return createHash("sha256").update(`${scope}\n${recipient.toLowerCase()}\n${subject}\n${body}`).digest("hex").slice(0, 40);
}

export async function deliverToSelf(mailer: Mailer, selfEmail: string, message: { subject: string; body: string }, scope: string): Promise<DeliveryResult> {
  try {
    assertRecipientAllowed(selfEmail);
  } catch (err) {
    return { status: "failed", messageId: null, error: (err as Error).message };
  }
  const key = sendKey(scope, message.subject, message.body, selfEmail);
  const previous = sent.get(key);
  if (previous) return { status: "sent", messageId: previous, error: null, duplicate: true };
  sent.set(key, "pending");
  try {
    const { id } = await mailer.send({ to: selfEmail, subject: message.subject, body: message.body });
    sent.set(key, id);
    return { status: "sent", messageId: id, error: null };
  } catch (err) {
    sent.delete(key); // allow a later retry
    return { status: "failed", messageId: null, error: `${mailer.provider === "resend" ? "Resend" : "Gmail"} send failed: ${(err as Error).message}` };
  }
}

// send_email_to_self via Resend (free tier: 3,000 emails/month, 100/day). Fallback when a Gmail
// app password isn't available. Uses the REST API directly: no SDK, no extra dependency.
// Recipient is still only ever GMAIL_USER_EMAIL (server-side allowlist).
import { assertRecipientAllowed, configuredSelfAddress, safeHeader, type Mailer } from "./gmail";

/** Resend's shared test sender works without verifying a domain, but only delivers to the Resend account's own email. */
export const RESEND_DEFAULT_FROM = "Sprinto Intelligence <onboarding@resend.dev>";

export function resendMailer(fetchImpl: typeof fetch = fetch): Mailer | null {
  const key = process.env.RESEND_API_KEY?.trim();
  const self = configuredSelfAddress();
  if (!key || !self) return null;
  const from = process.env.RESEND_FROM?.trim() || RESEND_DEFAULT_FROM;
  return {
    provider: "resend",
    from,
    async send({ to, subject, body }) {
      assertRecipientAllowed(to);
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [self], subject: safeHeader(subject), text: body }),
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        const hint = res.status === 403 && from === RESEND_DEFAULT_FROM
          ? " (with the onboarding@resend.dev sender, GMAIL_USER_EMAIL must be the same email you signed up to Resend with)"
          : res.status === 401 ? " (check RESEND_API_KEY)" : "";
        throw new Error(`Resend HTTP ${res.status}: ${json.message ?? "send failed"}${hint}`);
      }
      if (!json.id) throw new Error("Resend returned no message id");
      return { id: json.id };
    },
  };
}

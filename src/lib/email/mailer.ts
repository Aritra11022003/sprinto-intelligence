// Picks the email provider. Both are free:
//   1. Gmail SMTP  (GMAIL_USER_EMAIL + GMAIL_APP_PASSWORD), preferred
//   2. Resend      (GMAIL_USER_EMAIL + RESEND_API_KEY), fallback
// EMAIL_PROVIDER=gmail|resend forces one. Either way, the only recipient is GMAIL_USER_EMAIL.
import { gmailMailer, type Mailer } from "./gmail";
import { resendMailer } from "./resend";

export function getMailer(): Mailer | null {
  const forced = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (forced === "resend") return resendMailer();
  if (forced === "gmail") return gmailMailer();
  return gmailMailer() ?? resendMailer();
}

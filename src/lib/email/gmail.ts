// send_email_to_self via Gmail SMTP with an App Password (free). Only ever sends to GMAIL_USER_EMAIL:
// the recipient is never taken from research data or from the browser.
import nodemailer from "nodemailer";

export class RecipientNotAllowedError extends Error {
  constructor(recipient: string) {
    super(`Refusing to send to ${recipient}: only the configured GMAIL_USER_EMAIL may receive emails`);
    this.name = "RecipientNotAllowedError";
  }
}

export interface Mailer {
  readonly provider: "gmail" | "resend";
  readonly from: string;
  send(msg: { to: string; subject: string; body: string }): Promise<{ id: string }>;
}

export function configuredSelfAddress(): string | null {
  const v = process.env.GMAIL_USER_EMAIL?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

/** The only allowed recipient list. */
export function recipientAllowlist(): string[] {
  const self = configuredSelfAddress();
  return self ? [self] : [];
}

export function assertRecipientAllowed(recipient: string): void {
  const r = recipient.trim().toLowerCase();
  const allow = recipientAllowlist();
  if (allow.length === 0 || !allow.includes(r)) throw new RecipientNotAllowedError(recipient);
}

/** Strip CR/LF so a subject can never inject extra headers. */
export const safeHeader = (v: string) => v.replace(/[\r\n]+/g, " ").trim().slice(0, 200);

export function gmailMailer(): Mailer | null {
  const self = configuredSelfAddress();
  const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  if (!self || !pass) return null;
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: self, pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 });
  return {
    provider: "gmail",
    from: self,
    async send({ to, subject, body }) {
      assertRecipientAllowed(to);
      const info = await transport.sendMail({ from: `Sprinto Intelligence <${self}>`, to: self, subject: safeHeader(subject), text: body });
      return { id: info.messageId };
    },
  };
}

// Email providers: Gmail (app password) preferred, Resend as the free fallback. Both send only to self.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMailer } from "@/lib/email/mailer";
import { RESEND_DEFAULT_FROM, resendMailer } from "@/lib/email/resend";

const SELF = "me@example.com";
const KEYS = ["GMAIL_USER_EMAIL", "GMAIL_APP_PASSWORD", "RESEND_API_KEY", "RESEND_FROM", "EMAIL_PROVIDER"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
});

describe("provider selection", () => {
  it("returns no mailer when nothing is configured", () => {
    expect(getMailer()).toBeNull();
  });
  it("prefers Gmail when an app password is set", () => {
    Object.assign(process.env, { GMAIL_USER_EMAIL: SELF, GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop", RESEND_API_KEY: "re_test" });
    expect(getMailer()?.provider).toBe("gmail");
  });
  it("falls back to Resend when only a Resend key is set", () => {
    Object.assign(process.env, { GMAIL_USER_EMAIL: SELF, RESEND_API_KEY: "re_test" });
    expect(getMailer()?.provider).toBe("resend");
  });
  it("honours EMAIL_PROVIDER", () => {
    Object.assign(process.env, { GMAIL_USER_EMAIL: SELF, GMAIL_APP_PASSWORD: "x", RESEND_API_KEY: "re_test", EMAIL_PROVIDER: "resend" });
    expect(getMailer()?.provider).toBe("resend");
  });
  it("needs the recipient address for either provider", () => {
    process.env.RESEND_API_KEY = "re_test";
    expect(getMailer()).toBeNull();
  });
});

describe("Resend mailer", () => {
  it("posts to the Resend API, always to self, and returns the message id", async () => {
    Object.assign(process.env, { GMAIL_USER_EMAIL: SELF, RESEND_API_KEY: "re_test" });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "res_123" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const m = resendMailer(fetchImpl)!;
    const r = await m.send({ to: SELF, subject: "hello\r\nBcc: x@y.com", body: "body text" });
    expect(r.id).toBe("res_123");
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload.to).toEqual([SELF]);
    expect(payload.from).toBe(RESEND_DEFAULT_FROM);
    expect(payload.subject).not.toMatch(/[\r\n]/);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
  });
  it("refuses any other recipient before calling the API", async () => {
    Object.assign(process.env, { GMAIL_USER_EMAIL: SELF, RESEND_API_KEY: "re_test" });
    let called = false;
    const m = resendMailer((async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch)!;
    await expect(m.send({ to: "prospect@company.com", subject: "s", body: "b" })).rejects.toThrow(/Refusing/);
    expect(called).toBe(false);
  });
  it("explains the common onboarding-sender restriction", async () => {
    Object.assign(process.env, { GMAIL_USER_EMAIL: SELF, RESEND_API_KEY: "re_test" });
    const m = resendMailer((async () => new Response(JSON.stringify({ message: "You can only send testing emails to your own email address" }), { status: 403 })) as unknown as typeof fetch)!;
    await expect(m.send({ to: SELF, subject: "s", body: "b" })).rejects.toThrow(/same email you signed up to Resend with/);
  });
});

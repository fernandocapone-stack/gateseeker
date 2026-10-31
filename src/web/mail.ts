/**
 * Email for the monitor (docs/SPRINT_6.md 3.6): a small sending interface so
 * the provider can change without touching the rest, the Brevo
 * implementation, an in-memory one for local runs and tests, and the lookup
 * of an account's address. Gateseeker keeps no copy of email addresses: the
 * address is read from Supabase Auth at the moment of sending.
 */

export const EMAIL_KINDS = ["follow_confirm", "alert", "paused"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export interface EmailMessage {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export interface Mailer {
  /** Sends one message; throws MailError when the provider refuses it or cannot be reached. */
  send(message: EmailMessage): Promise<void>;
}

export class MailError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "MailError";
  }
}

export interface BrevoMailerOptions {
  apiKey: string;
  from: { email: string; name: string };
  fetch?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
}

export const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/** Brevo transactional API. The key goes only in the request header and is never logged. */
export function createBrevoMailer(options: BrevoMailerOptions): Mailer {
  const doFetch = options.fetch ?? fetch;
  return {
    async send(m) {
      let res: Response;
      try {
        res = await doFetch(options.endpoint ?? BREVO_ENDPOINT, {
          method: "POST",
          headers: { "api-key": options.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ sender: options.from, to: [{ email: m.to }], subject: m.subject, textContent: m.text, htmlContent: m.html, headers: m.headers, tags: [`gateseeker-${m.kind}`] }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
      } catch (e) {
        throw new MailError(`email provider unreachable: ${(e as Error).message}`, null);
      }
      // The body may echo the request; only the status is reported.
      if (!res.ok) throw new MailError(`email provider answered HTTP ${String(res.status)}`, res.status);
    },
  };
}

/** Keeps messages in memory: the local server and the browser tests read them instead of sending. */
export function createMemoryMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    // eslint-disable-next-line @typescript-eslint/require-await
    async send(m) {
      sent.push(m);
    },
  };
}

export interface EmailDirectory {
  /** The account's email address, or null when it has none (or it cannot be read). */
  emailOf(userId: string): Promise<string | null>;
}

const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,24}$/;

/** Supabase Auth admin API with the service_role key, read at send time. */
export function createSupabaseDirectory(options: { url: string; serviceKey: string; fetch?: typeof fetch; timeoutMs?: number }): EmailDirectory {
  const doFetch = options.fetch ?? fetch;
  const base = options.url.replace(/\/+$/, "");
  const legacyJwt = options.serviceKey.startsWith("ey");
  const headers = { apikey: options.serviceKey, ...(legacyJwt ? { authorization: `Bearer ${options.serviceKey}` } : {}) };
  return {
    async emailOf(userId) {
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
      try {
        const res = await doFetch(`${base}/auth/v1/admin/users/${userId}`, { headers, signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
        if (!res.ok) return null;
        const body = (await res.json()) as { email?: unknown };
        return typeof body.email === "string" && EMAIL.test(body.email) ? body.email : null;
      } catch {
        return null;
      }
    },
  };
}

export function createStaticDirectory(addresses: Record<string, string>): EmailDirectory {
  return { emailOf: (userId) => Promise.resolve(addresses[userId] ?? null) };
}

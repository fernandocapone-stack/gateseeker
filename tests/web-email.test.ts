import { describe, expect, it } from "vitest";

import { alertEmail, escapeHtml, followConfirmationEmail, mergeAlert, pausedEmail, unsubscribeToken, verifyUnsubscribe, type EmailContext, type PendingAlert } from "../src/web/emails.js";
import { createBrevoMailer, createSupabaseDirectory, MailError, type EmailMessage } from "../src/web/mail.js";

/**
 * Email content and plumbing (docs/SPRINT_6.md 3.6, tests 3 and 4): escaped
 * hostile values, links only to the site, signed unsubscribe tokens, and the
 * Brevo and Supabase Auth calls. No network: fetch doubles only.
 */

const KEY = "e".repeat(32);
const FOLLOW = "55555555-5555-4555-8555-555555555555";
const ctx: EmailContext = { to: "dev@example.test", owner: "acme", repo: "vibe", followId: FOLLOW, baseUrl: "https://gateseeker.example", key: KEY };
const alert: PendingAlert = { reportId: "r-123", count: 3, items: [{ priority: "P1", id: "GSK-PAT-CORS-001", label: "Wildcard CORS with credentials" }, { priority: "P2", id: "GHSA-xxxx", label: "vulnerable dependency left-pad" }] };

/** Control characters; line breaks are allowed in bodies, not in subjects. */
function hasControl(s: string, noBreaks: boolean): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 10 || code === 13) {
      if (noBreaks) return true;
    } else if (code < 32 || (code >= 127 && code < 160)) return true;
  }
  return false;
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => (m[1] ?? "").replace(/&amp;/g, "&"));
}

describe("unsubscribe token", () => {
  it("is bound to one follow and the key; tampered or foreign tokens are refused", () => {
    const t = unsubscribeToken(KEY, FOLLOW);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyUnsubscribe(KEY, FOLLOW, t)).toBe(true);
    expect(verifyUnsubscribe(KEY, "66666666-6666-4666-8666-666666666666", t)).toBe(false);
    expect(verifyUnsubscribe("x".repeat(32), FOLLOW, t)).toBe(false);
    expect(verifyUnsubscribe(KEY, FOLLOW, `${t.slice(0, 31)}${t.endsWith("0") ? "1" : "0"}`)).toBe(false);
    expect(verifyUnsubscribe(KEY, FOLLOW, "not-hex")).toBe(false);
  });
});

describe("email templates", () => {
  it("alert: count, closed list of items, report and unsubscribe links to the site only, one-click headers", () => {
    const m = alertEmail(ctx, alert);
    expect(m.kind).toBe("alert");
    expect(m.subject).toBe("acme/vibe: 3 new findings to fix soon");
    expect(m.text).toContain("P1 · GSK-PAT-CORS-001 · Wildcard CORS with credentials");
    expect(m.text).toContain("and 1 more");
    expect(m.text).toContain("https://gateseeker.example/r/r-123?from=email");
    const token = unsubscribeToken(KEY, FOLLOW);
    expect(m.text).toContain(`https://gateseeker.example/unsubscribe?f=${FOLLOW}&t=${token}`);
    expect(m.headers).toEqual({ "List-Unsubscribe": `<https://gateseeker.example/api/unsubscribe?f=${FOLLOW}&t=${token}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    for (const href of hrefs(m.html)) expect(href.startsWith("https://gateseeker.example/")).toBe(true);
    expect(hrefs(m.html)).toHaveLength(2);
    // Never claims the repository is secure or safe (rule 3).
    expect(`${m.text} ${m.html}`).not.toMatch(/\b(secure|safe|free of vulnerabilities)\b/i);
  });

  it("escapes hostile names in the HTML and strips control characters from the text and subject", () => {
    const hostile: EmailContext = { ...ctx, owner: 'a"><img src=x onerror=alert(1)>', repo: "r\u001b[31m\nBcc: x@evil.test" };
    const evil: PendingAlert = { reportId: "javascript:alert(1)", count: 1, items: [{ priority: "P1", id: "<b>ID</b>", label: "<script>alert(1)</script>\u0007" }] };
    for (const m of [alertEmail(hostile, evil), followConfirmationEmail(hostile), pausedEmail(hostile, "<i>gone</i>")]) {
      expect(m.html).not.toMatch(/<img|<script|<b>|<i>/);
      expect(m.html).toContain("&lt;");
      expect(hasControl(m.subject, true)).toBe(false);
      expect(hasControl(m.text, false)).toBe(false);
      for (const href of hrefs(m.html)) expect(href.startsWith("https://gateseeker.example/")).toBe(true);
    }
    // An id that is not report-shaped never becomes a link to it.
    expect(alertEmail(hostile, evil).text).toContain("https://gateseeker.example/app/scans");
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });

  it("confirmation and paused notices say what happens next", () => {
    expect(followConfirmationEmail(ctx).text).toContain("at most once a day");
    expect(pausedEmail(ctx, "The repository is private now.").text).toContain("stopped the daily check of acme/vibe: The repository is private now.");
  });

  it("merges a newer rescan into an alert not sent yet, without duplicates and with a cap", () => {
    const merged = mergeAlert(alert, { reportId: "r-456", count: 2, items: [alert.items[0] ?? { priority: "P1", id: "x", label: "x" }, { priority: "P1", id: "GSK-SECRET-001", label: "Hardcoded credential" }] });
    expect(merged).toMatchObject({ reportId: "r-456", count: 5 });
    expect(merged.items.map((i) => i.id)).toEqual(["GSK-PAT-CORS-001", "GHSA-xxxx", "GSK-SECRET-001"]);
    const many = { reportId: "r", count: 20, items: Array.from({ length: 20 }, (_, i) => ({ priority: "P2" as const, id: `ID-${String(i)}`, label: "x" })) };
    expect(mergeAlert(null, many).items).toHaveLength(10);
  });
});

describe("Brevo mailer", () => {
  const message: EmailMessage = { kind: "alert", to: "dev@example.test", subject: "s", text: "t", html: "<p>h</p>", headers: { "List-Unsubscribe": "<https://x/api/unsubscribe>" } };

  it("posts the message with the key in the api-key header only", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    // eslint-disable-next-line @typescript-eslint/require-await
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
      return new Response(JSON.stringify({ messageId: "m" }), { status: 201 });
    }) as typeof fetch;
    await createBrevoMailer({ apiKey: "xkeysib-test", from: { email: "alerts@gateseeker.example", name: "Gateseeker" }, fetch: f }).send(message);
    expect(calls[0]?.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(calls[0]?.init?.headers).toMatchObject({ "api-key": "xkeysib-test" });
    const raw = calls[0]?.init?.body;
    const body = JSON.parse(typeof raw === "string" ? raw : "{}") as Record<string, unknown>;
    expect(body).toMatchObject({ sender: { email: "alerts@gateseeker.example", name: "Gateseeker" }, to: [{ email: "dev@example.test" }], subject: "s", textContent: "t", htmlContent: "<p>h</p>", headers: message.headers, tags: ["gateseeker-alert"] });
    expect(JSON.stringify(body)).not.toContain("xkeysib-test");
  });

  it("reports refusals and network failures as MailError without the response body", async () => {
    const refused = createBrevoMailer({ apiKey: "k", from: { email: "a@b.co", name: "G" }, fetch: () => Promise.resolve(new Response('{"message":"echo of request"}', { status: 401 })) });
    await expect(refused.send(message)).rejects.toThrow(new MailError("email provider answered HTTP 401", 401));
    const down = createBrevoMailer({ apiKey: "k", from: { email: "a@b.co", name: "G" }, fetch: () => Promise.reject(new Error("offline")) });
    await expect(down.send(message)).rejects.toMatchObject({ name: "MailError", status: null });
  });
});

describe("Supabase directory", () => {
  it("reads the address from the Auth admin API at send time and returns null for anything odd", async () => {
    const seen: { url: string; headers: unknown }[] = [];
    const answer = (body: unknown, status = 200) => (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: input instanceof Request ? input.url : input.toString(), headers: init?.headers });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    };
    const id = "11111111-1111-4111-8111-111111111111";
    const dir = createSupabaseDirectory({ url: "https://p.supabase.co/", serviceKey: "sb_secret_x", fetch: answer({ id, email: "alice@example.test" }) });
    expect(await dir.emailOf(id)).toBe("alice@example.test");
    expect(seen[0]).toEqual({ url: `https://p.supabase.co/auth/v1/admin/users/${id}`, headers: { apikey: "sb_secret_x" } });
    expect(await dir.emailOf("../users")).toBeNull();
    expect(seen).toHaveLength(1);
    expect(await createSupabaseDirectory({ url: "https://p.supabase.co", serviceKey: "eyJx", fetch: answer({ email: null }) }).emailOf(id)).toBeNull();
    expect(await createSupabaseDirectory({ url: "https://p.supabase.co", serviceKey: "k", fetch: answer({ email: "a@b.co\r\nBcc: x@evil.test" }) }).emailOf(id)).toBeNull();
    expect(await createSupabaseDirectory({ url: "https://p.supabase.co", serviceKey: "k", fetch: answer({}, 404) }).emailOf(id)).toBeNull();
    expect(await createSupabaseDirectory({ url: "https://p.supabase.co", serviceKey: "k", fetch: (() => Promise.reject(new Error("down"))) }).emailOf(id)).toBeNull();
  });
});

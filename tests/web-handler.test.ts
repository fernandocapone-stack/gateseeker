import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { bearerToken, createStaticAuth, createSupabaseAuth } from "../src/web/auth.js";
import { authConfigFromEnv, handlerOptionsFromEnv, STUB_TOKEN, STUB_USER } from "../src/web/env.js";
import { currentAdvisories, handleCleanupRequest, handleEventRequest, handleFeedPublishedRequest, handleFollowsRequest, handleUnsubscribeRequest, type MailSettings, handleMonitorRequest, handleReportRequest, handleScanRequest, handleScansRequest, type HandlerOptions, type ScanResponseOk } from "../src/web/handler.js";
import { advisorySetFromText } from "../src/intel/advisories.js";
import { signFeed } from "../src/intel/feed-signature.js";
import { createMemoryMailer, createStaticDirectory } from "../src/web/mail.js";
import { createMemoryStore, createSupabaseStore, type ReportStore } from "../src/web/store.js";
import { fixturePath, readJsonFixture } from "./helpers.js";

/**
 * The hosted service's layers above the engine: session verification, the
 * per-user quota, the per-commit cache, saved reports and the cleanup. No
 * network: Supabase and GitHub are fetch doubles.
 */

// --- a minimal tar writer (plain files only) and a GitHub double ------------

function header(name: string, size: number): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, "utf8");
  h.write("0000644\0", 100, "ascii");
  h.write("0000000\0", 108, "ascii");
  h.write("0000000\0", 116, "ascii");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  h.write("00000000000\0", 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

function targz(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    parts.push(header(name, data.length), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(parts));
}

const SHA = "b".repeat(40);
const ARCHIVE = targz({ "r-bbbb/package.json": '{"name":"r"}', "r-bbbb/src/server.ts": 'app.use(cors({ origin: "*", credentials: true }));\n' });

function fakeGitHub(archive: Buffer = ARCHIVE): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  // eslint-disable-next-line @typescript-eslint/require-await -- a fetch double must return a Promise<Response>
  const f = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("https://api.github.com/repos/") && !url.includes("/commits/")) {
      return new Response(JSON.stringify({ full_name: "o/r", private: false, size: 10, default_branch: "main", html_url: "https://github.com/o/r" }), { status: 200 });
    }
    if (url.includes("/commits/")) return new Response(JSON.stringify({ sha: SHA }), { status: 200 });
    if (url.startsWith("https://codeload.github.com/")) return new Response(archive, { status: 200 });
    if (url.includes("osv.dev")) return new Response(JSON.stringify({ vulns: [] }), { status: 200 });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "gsk-handler-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function baseOptions(gh: ReturnType<typeof fakeGitHub>, extra: Partial<HandlerOptions> = {}): HandlerOptions {
  return { fetch: gh.fetch, workDir: freshDir(), scan: { osv: { fetch: gh.fetch }, packagist: false }, ...extra };
}

const ALICE = { id: "11111111-1111-4111-8111-111111111111", login: "alice" };
const BOB = { id: "22222222-2222-4222-8222-222222222222", login: "bob" };
const auth = createStaticAuth({ "tok-alice": ALICE, "tok-bob": BOB });

// --- auth --------------------------------------------------------------------

describe("bearerToken", () => {
  it("extracts the token and rejects other schemes", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
  });
});

describe("createSupabaseAuth", () => {
  const token = "x".repeat(32);
  it("asks Supabase who the token belongs to and reads the GitHub login", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    // eslint-disable-next-line @typescript-eslint/require-await
    const f = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      seen.push({ url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ id: ALICE.id, user_metadata: { user_name: "alice" } }), { status: 200 });
    }) as typeof fetch;
    const v = createSupabaseAuth({ url: "https://p.supabase.co/", anonKey: "anon", fetch: f });
    expect(await v.verify(token)).toEqual(ALICE);
    expect(seen[0]?.url).toBe("https://p.supabase.co/auth/v1/user");
    expect(seen[0]?.headers).toEqual({ apikey: "anon", authorization: `Bearer ${token}` });
  });

  it("treats 401, malformed bodies, odd logins and network failures as no user", async () => {
    const mk = (res: () => Response | Promise<Response>) => createSupabaseAuth({ url: "https://p.supabase.co", anonKey: "anon", fetch: () => Promise.resolve().then(res) });
    expect(await mk(() => new Response("{}", { status: 401 })).verify(token)).toBeNull();
    expect(await mk(() => new Response("not json", { status: 200 })).verify(token)).toBeNull();
    expect(await mk(() => new Response(JSON.stringify({ id: "" }), { status: 200 })).verify(token)).toBeNull();
    expect(await mk(() => { throw new Error("down"); }).verify(token)).toBeNull();
    const weird = await mk(() => new Response(JSON.stringify({ id: ALICE.id, user_metadata: { user_name: "<script>" } }), { status: 200 })).verify(token);
    expect(weird).toEqual({ id: ALICE.id, login: null });
  });

  it("never calls Supabase for a token that is not token-shaped", async () => {
    let called = false;
    const v = createSupabaseAuth({ url: "https://p.supabase.co", anonKey: "anon", fetch: () => { called = true; return Promise.resolve(new Response("{}")); } });
    expect(await v.verify("short")).toBeNull();
    expect(await v.verify("bad token with spaces and more characters here")).toBeNull();
    expect(called).toBe(false);
  });
});

// --- memory store ------------------------------------------------------------

describe("createMemoryStore", () => {
  it("counts a fixed window per user and resets it when it elapses", async () => {
    let t = Date.parse("2026-10-28T10:00:00Z");
    const store = createMemoryStore({ now: () => new Date(t) });
    expect(await store.claimQuota(ALICE.id, 2, 3600)).toMatchObject({ allowed: true, used: 1, limit: 2, resetAt: "2026-10-28T11:00:00.000Z" });
    expect(await store.claimQuota(ALICE.id, 2, 3600)).toMatchObject({ allowed: true, used: 2 });
    expect(await store.claimQuota(ALICE.id, 2, 3600)).toMatchObject({ allowed: false, used: 2 });
    expect(await store.claimQuota(BOB.id, 2, 3600)).toMatchObject({ allowed: true, used: 1 });
    t += 3600 * 1000;
    expect(await store.claimQuota(ALICE.id, 2, 3600)).toMatchObject({ allowed: true, used: 1, resetAt: "2026-10-28T12:00:00.000Z" });
  });

  it("finds a recent report for a commit regardless of owner, serves reports only to their owner, purges expired ones", async () => {
    let t = Date.parse("2026-10-28T10:00:00Z");
    const store = createMemoryStore({ now: () => new Date(t) });
    const id = await store.save({ userId: ALICE.id, owner: "o", repo: "r", ref: null, sha: SHA, cachedFrom: null, body: { n: 1 }, expiresAt: "2026-11-27T10:00:00.000Z" });
    expect(await store.get(id, ALICE.id)).toMatchObject({ id, body: { n: 1 } });
    expect(await store.get(id, BOB.id)).toBeNull();
    expect(await store.get("nope", ALICE.id)).toBeNull();
    expect((await store.findRecent("o", "r", SHA, 24 * 3600 * 1000))?.id).toBe(id);
    expect(await store.findRecent("o", "r", "c".repeat(40), 24 * 3600 * 1000)).toBeNull();
    t += 25 * 3600 * 1000;
    expect(await store.findRecent("o", "r", SHA, 24 * 3600 * 1000)).toBeNull();
    expect(await store.purgeExpired()).toBe(0);
    t = Date.parse("2026-12-01T00:00:00Z");
    expect(await store.purgeExpired()).toBe(1);
    expect(await store.get(id, ALICE.id)).toBeNull();
  });
});

// --- supabase store (PostgREST double) ----------------------------------------

describe("createSupabaseStore", () => {
  interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined }
  function postgrest(answer: (c: Call) => Response): { store: ReportStore; calls: Call[] } {
    const calls: Call[] = [];
    // eslint-disable-next-line @typescript-eslint/require-await
    const f = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const c: Call = { method: init?.method ?? "GET", url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, headers: init?.headers as Record<string, string>, body: typeof init?.body === "string" ? init.body : undefined };
      calls.push(c);
      return answer(c);
    }) as typeof fetch;
    return { store: createSupabaseStore({ url: "https://p.supabase.co", serviceKey: "service", fetch: f, now: () => new Date("2026-10-28T10:00:00Z") }), calls };
  }
  const row = { id: "33333333-3333-4333-8333-333333333333", user_id: ALICE.id, owner: "o", repo: "r", ref: null, sha: SHA, cached_from: null, body: { n: 1 }, created_at: "2026-10-28T09:00:00+00:00", expires_at: "2026-11-27T09:00:00+00:00" };

  it("claims quota through the claim_scan function with the service key", async () => {
    const { store, calls } = postgrest(() => new Response(JSON.stringify({ allowed: true, used: 1, limit: 10, reset_at: "2026-10-28T11:00:00+00:00" })));
    expect(await store.claimQuota(ALICE.id, 10, 3600)).toEqual({ allowed: true, used: 1, limit: 10, resetAt: "2026-10-28T11:00:00+00:00" });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://p.supabase.co/rest/v1/rpc/claim_scan", body: JSON.stringify({ p_user: ALICE.id, p_limit: 10, p_window_seconds: 3600 }) });
    expect(calls[0]?.headers).toMatchObject({ apikey: "service" });
    expect(calls[0]?.headers).not.toHaveProperty("authorization");
  });

  it("counts events through the count_event function with the kind only", async () => {
    const { store, calls } = postgrest(() => new Response(""));
    await store.countEvent("login_view");
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://p.supabase.co/rest/v1/rpc/count_event", body: JSON.stringify({ p_kind: "login_view" }) });
  });

  it("sends a legacy JWT service_role key in both headers", async () => {
    const calls: Call[] = [];
    // eslint-disable-next-line @typescript-eslint/require-await
    const f = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ method: init?.method ?? "GET", url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, headers: init?.headers as Record<string, string>, body: undefined });
      return new Response(JSON.stringify([]));
    }) as typeof fetch;
    const store = createSupabaseStore({ url: "https://p.supabase.co", serviceKey: "eyJhbGciOi.payload.sig", fetch: f });
    expect(await store.purgeExpired()).toBe(0);
    expect(calls[0]?.headers).toMatchObject({ apikey: "eyJhbGciOi.payload.sig", authorization: "Bearer eyJhbGciOi.payload.sig" });
  });

  it("queries the cache by commit and age, inserts with return=representation, scopes get by owner", async () => {
    const { store, calls } = postgrest((c) => (c.method === "POST" ? new Response(JSON.stringify([{ id: row.id }]), { status: 201 }) : new Response(JSON.stringify([row]))));
    const hit = await store.findRecent("o", "r", SHA, 24 * 3600 * 1000);
    expect(hit?.id).toBe(row.id);
    expect(decodeURIComponent(calls[0]?.url ?? "")).toBe(`https://p.supabase.co/rest/v1/reports?owner=eq.o&repo=eq.r&sha=eq.${SHA}&created_at=gte.2026-10-27T10:00:00.000Z&order=created_at.desc&limit=1`);
    expect(await store.save({ userId: ALICE.id, owner: "o", repo: "r", ref: null, sha: SHA, cachedFrom: null, body: { n: 1 }, expiresAt: "2026-11-27T10:00:00.000Z" })).toBe(row.id);
    expect(calls[1]).toMatchObject({ method: "POST", url: "https://p.supabase.co/rest/v1/reports?select=id" });
    expect(calls[1]?.headers).toMatchObject({ prefer: "return=representation" });
    expect(await store.get(row.id, ALICE.id)).toMatchObject({ id: row.id, userId: ALICE.id });
    expect(decodeURIComponent(calls[2]?.url ?? "")).toContain(`id=eq.${row.id}&user_id=eq.${ALICE.id}`);
    expect(await store.get("not-a-uuid", ALICE.id)).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it("writes and reads scan history through PostgREST, scoped to the user, and purges lines older than 180 days", async () => {
    const histRow = { id: "44444444-4444-4444-8444-444444444444", user_id: ALICE.id, owner: "o", repo: "r", sha: SHA, verdict: "fail", p1: 2, p2: 1, p3: 0, p4: 0, report_id: row.id, created_at: "2026-10-28T09:00:00+00:00" };
    const { store, calls } = postgrest((c) => new Response(c.method === "GET" ? JSON.stringify([histRow]) : ""));
    await store.recordScan({ userId: ALICE.id, owner: "o", repo: "r", sha: SHA, verdict: "fail", byPriority: { P1: 2, P2: 1, P3: 0, P4: 0 }, reportId: row.id });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://p.supabase.co/rest/v1/scans" });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ user_id: ALICE.id, owner: "o", repo: "r", sha: SHA, verdict: "fail", p1: 2, p2: 1, p3: 0, p4: 0, report_id: row.id });
    expect(await store.listScans(ALICE.id, 100)).toEqual([{ id: histRow.id, userId: ALICE.id, owner: "o", repo: "r", sha: SHA, verdict: "fail", byPriority: { P1: 2, P2: 1, P3: 0, P4: 0 }, reportId: row.id, createdAt: histRow.created_at }]);
    expect(decodeURIComponent(calls[1]?.url ?? "")).toContain(`user_id=eq.${ALICE.id}`);
    await store.purgeExpired();
    expect(decodeURIComponent(calls[3]?.url ?? "")).toContain("/rest/v1/scans?created_at=lt.2026-05-01T10:00:00.000Z");
    const bad = postgrest(() => new Response(JSON.stringify([{ id: "x" }]))).store;
    await expect(bad.listScans(ALICE.id, 10)).rejects.toMatchObject({ name: "StoreError" });
  });

  it("follows through the follow_repo function, lists due follows oldest first and patches only the given fields", async () => {
    const followRow = { id: "55555555-5555-4555-8555-555555555555", user_id: ALICE.id, owner: "o", repo: "r", created_at: "2026-10-28T09:00:00+00:00", last_scan_at: null, last_report_id: null, last_verdict: null, last_new_urgent: 0, failures: 0, paused_reason: null };
    const { store, calls } = postgrest((c) => (c.url.includes("/rpc/") ? new Response(JSON.stringify({ ok: true, follow: followRow })) : new Response(c.method === "GET" ? JSON.stringify([followRow]) : "")));
    expect(await store.follow(ALICE.id, "o", "r", 10)).toMatchObject({ ok: true, follow: { id: followRow.id, owner: "o", lastScanAt: null } });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://p.supabase.co/rest/v1/rpc/follow_repo", body: JSON.stringify({ p_user: ALICE.id, p_owner: "o", p_repo: "r", p_limit: 10 }) });
    expect(await store.dueFollows("2026-10-27T14:00:00.000Z", 200)).toHaveLength(1);
    expect(decodeURIComponent(calls[1]?.url ?? "")).toBe("https://p.supabase.co/rest/v1/follows?paused_reason=is.null&or=(queued_at.not.is.null,last_scan_at.is.null,last_scan_at.lt.2026-10-27T14:00:00.000Z)&order=queued_at.asc.nullslast,last_scan_at.asc.nullsfirst&limit=200");
    await store.updateFollow(followRow.id, { failures: 2, lastScanAt: "2026-10-28T10:00:00.000Z" });
    expect(calls[2]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(calls[2]?.body ?? "{}")).toEqual({ last_scan_at: "2026-10-28T10:00:00.000Z", failures: 2 });
    await store.unfollow(ALICE.id, "o", "r");
    expect(calls[3]).toMatchObject({ method: "DELETE" });
    expect(decodeURIComponent(calls[3]?.url ?? "")).toContain(`user_id=eq.${ALICE.id}&owner=eq.o&repo=eq.r`);
    const full = postgrest(() => new Response(JSON.stringify({ ok: false, reason: "limit" }))).store;
    expect(await full.follow(ALICE.id, "o", "x", 10)).toEqual({ ok: false, reason: "limit" });
  });

  it("claims emails through claim_email, reads and deletes a follow by id, and reports whether a follow is new", async () => {
    const followRow = { id: "55555555-5555-4555-8555-555555555555", user_id: ALICE.id, owner: "o", repo: "r", created_at: "2026-10-28T09:00:00+00:00", last_scan_at: null, last_report_id: null, last_verdict: null, last_new_urgent: 0, failures: 0, paused_reason: null, pending_alert: { reportId: "r-1", count: 1, items: [{ priority: "P1", id: "GSK-X", label: "x" }] }, last_alert_at: null };
    const { store, calls } = postgrest((c) => {
      if (c.url.endsWith("/rpc/claim_email")) return new Response("true");
      if (c.url.endsWith("/rpc/follow_repo")) return new Response(JSON.stringify({ ok: true, created: true, follow: followRow }));
      return new Response(JSON.stringify([followRow]));
    });
    expect(await store.claimEmail(250)).toBe(true);
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://p.supabase.co/rest/v1/rpc/claim_email", body: JSON.stringify({ p_limit: 250 }) });
    expect(await store.follow(ALICE.id, "o", "r", 10)).toMatchObject({ ok: true, created: true });
    expect(await store.getFollow(followRow.id)).toMatchObject({ id: followRow.id, pendingAlert: { count: 1 } });
    expect(await store.deleteFollow(followRow.id)).toBe(true);
    expect(calls[3]).toMatchObject({ method: "DELETE" });
    expect(calls[3]?.headers).toMatchObject({ prefer: "return=representation" });
    expect(decodeURIComponent(calls[3]?.url ?? "")).toBe(`https://p.supabase.co/rest/v1/follows?id=eq.${followRow.id}&select=id`);
    // Ids that are not UUIDs never reach the database.
    expect(await store.getFollow("x")).toBeNull();
    expect(await store.deleteFollow("x")).toBe(false);
    expect(calls).toHaveLength(4);
    const capped = postgrest(() => new Response("false")).store;
    expect(await capped.claimEmail(250)).toBe(false);
    // Before the email migration follow_repo does not say: no confirmation email.
    const old = postgrest(() => new Response(JSON.stringify({ ok: true, follow: followRow }))).store;
    expect(await old.follow(ALICE.id, "o", "r", 10)).toMatchObject({ ok: true, created: false });
  });

  it("queues follows by ecosystem overlap, stores feed sets and reads the latest one", async () => {
    const feedRow = { published_at: "2026-11-02T12:00:00+00:00", digest: "0123456789abcdef", payload: "[]", signature: "a".repeat(64) };
    const { store, calls } = postgrest((c) => (c.method === "PATCH" ? new Response(JSON.stringify([{ id: "a" }, { id: "b" }])) : new Response(c.method === "GET" ? JSON.stringify([feedRow]) : "", { status: c.method === "POST" ? 201 : 200 })));
    expect(await store.queueFollows(["Packagist", "npm", "bad}name"], "2026-11-02T12:00:00.000Z")).toBe(2);
    expect(decodeURIComponent(calls[0]?.url ?? "")).toBe("https://p.supabase.co/rest/v1/follows?paused_reason=is.null&ecosystems=ov.{Packagist,npm}&select=id");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ queued_at: "2026-11-02T12:00:00.000Z" });
    expect(calls[0]?.headers).toMatchObject({ prefer: "return=representation" });
    expect(await store.queueFollows(["bad}"], "x")).toBe(0);
    expect(calls).toHaveLength(1);
    await store.saveFeed({ publishedAt: "2026-11-02T12:00:00.000Z", digest: feedRow.digest, payload: "[]", signature: feedRow.signature });
    expect(calls[1]).toMatchObject({ method: "POST", url: "https://p.supabase.co/rest/v1/feed_sets" });
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ published_at: "2026-11-02T12:00:00.000Z", digest: feedRow.digest, payload: "[]", signature: feedRow.signature });
    expect(await store.latestFeed()).toEqual({ publishedAt: feedRow.published_at, digest: feedRow.digest, payload: "[]", signature: feedRow.signature });
    expect(decodeURIComponent(calls[2]?.url ?? "")).toBe("https://p.supabase.co/rest/v1/feed_sets?select=published_at,digest,payload,signature&order=published_at.desc&limit=1");
    const empty = postgrest(() => new Response("[]")).store;
    expect(await empty.latestFeed()).toBeNull();
    const bad = postgrest(() => new Response(JSON.stringify([{ digest: 1 }]))).store;
    await expect(bad.latestFeed()).rejects.toMatchObject({ name: "StoreError" });
  });

  it("deletes expired rows and counts them; surfaces HTTP and network failures as StoreError", async () => {
    const { store, calls } = postgrest(() => new Response(JSON.stringify([{ id: "a" }, { id: "b" }])));
    expect(await store.purgeExpired()).toBe(2);
    expect(calls[0]).toMatchObject({ method: "DELETE" });
    expect(decodeURIComponent(calls[0]?.url ?? "")).toContain("expires_at=lt.2026-10-28T10:00:00.000Z");
    const down = postgrest(() => new Response("nope", { status: 500 })).store;
    await expect(down.claimQuota(ALICE.id, 1, 1)).rejects.toMatchObject({ name: "StoreError", status: 500 });
    const offline = createSupabaseStore({ url: "https://p.supabase.co", serviceKey: "s", fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
    await expect(offline.purgeExpired()).rejects.toMatchObject({ name: "StoreError", status: null });
  });
});

// --- handlers ----------------------------------------------------------------

describe("handleScanRequest with auth and store", () => {
  it("refuses without a session and with an unknown token", async () => {
    const gh = fakeGitHub();
    const opts = baseOptions(gh, { auth, store: createMemoryStore() });
    expect(await handleScanRequest({ url: "https://github.com/o/r" }, opts, null)).toMatchObject({ status: 401, body: { ok: false, error: { code: "unauthorized" } } });
    expect(await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer nope")).toMatchObject({ status: 401 });
    expect(gh.calls).toHaveLength(0);
  });

  it("scans once, saves the report for the user, then reuses it for the same commit without spending quota", async () => {
    const gh = fakeGitHub();
    const store = createMemoryStore();
    const opts = baseOptions(gh, { auth, store, quota: { limit: 1, windowSeconds: 3600 } });
    const first = await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer tok-alice");
    expect(first.status).toBe(200);
    const a = first.body as ScanResponseOk;
    expect(a.cached).toBe(false);
    expect(a.id).toMatch(/^mem-/);
    expect(a.quota).toMatchObject({ allowed: true, used: 1, limit: 1 });
    expect(a.report.findings.some((f) => f.evidence.kind === "insecure-pattern" && f.evidence.ruleId === "GSK-CORS-001")).toBe(true);
    const downloads = gh.calls.filter((c) => c.includes("codeload")).length;
    expect(downloads).toBe(1);

    // Bob, same commit: served from the cache, his own id, no download, quota untouched (his first claim would still be allowed).
    const second = await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer tok-bob");
    const b = second.body as ScanResponseOk;
    expect(second.status).toBe(200);
    expect(b.cached).toBe(true);
    expect(b.id).not.toBe(a.id);
    expect(b.report.runId).toBe(a.report.runId);
    expect(gh.calls.filter((c) => c.includes("codeload")).length).toBe(1);
    expect(await store.claimQuota(BOB.id, 1, 3600)).toMatchObject({ allowed: true, used: 1 });

    // Each user sees only their own saved report.
    expect(await handleReportRequest(a.id ?? "", opts, "Bearer tok-alice")).toMatchObject({ status: 200, body: { ok: true, id: a.id, saved: { repository: { sha: SHA } } } });
    expect(await handleReportRequest(a.id ?? "", opts, "Bearer tok-bob")).toMatchObject({ status: 404 });
    expect(await handleReportRequest(a.id ?? "", opts, null)).toMatchObject({ status: 401 });
    expect(await handleReportRequest("../etc", opts, "Bearer tok-alice")).toMatchObject({ status: 404 });
  });

  it("saves a report without any full credential from the scanned project", async () => {
    // The vibe fixture carries the synthetic credentials of fixtures/projects/secrets.json; the saved JSON must hold none of them in full.
    const root = fixturePath("projects/vibe-next-supabase");
    const files: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else files[`r-bbbb/${relative(root, full).replace(/\\/g, "/")}`] = readFileSync(full, "utf8");
      }
    };
    walk(root);
    const secrets = readJsonFixture("projects/secrets.json") as Record<string, string>;
    const store = createMemoryStore();
    const opts = baseOptions(fakeGitHub(targz(files)), { auth, store });
    const res = await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer tok-alice");
    expect(res.status).toBe(200);
    const id = (res.body as ScanResponseOk).id ?? "";
    expect((res.body as ScanResponseOk).report.findings.some((f) => f.evidence.kind === "insecure-pattern" && f.evidence.ruleId === "GSK-SECRET-001")).toBe(true);
    const saved = await handleReportRequest(id, opts, "Bearer tok-alice");
    expect(saved.status).toBe(200);
    const json = JSON.stringify(saved.body);
    for (const [name, value] of Object.entries(secrets)) {
      // The anon key is public by design and never reported; every other value must not survive redaction.
      if (name !== "anon") expect(json, `secret ${name} reached the store`).not.toContain(value);
    }
  });

  it("keeps a history line per analysis, cached ones included, and serves it only to its owner", async () => {
    let t = Date.parse("2026-10-31T10:00:00Z");
    const store = createMemoryStore({ now: () => new Date(t) });
    const opts = baseOptions(fakeGitHub(), { auth, store });
    const first = await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer tok-alice");
    t += 60_000;
    const again = await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer tok-alice");
    expect((again.body as ScanResponseOk).cached).toBe(true);
    const hist = await handleScansRequest(opts, "Bearer tok-alice");
    expect(hist.status).toBe(200);
    const scans = (hist.body as { scans: { reportId: string | null; owner: string; repo: string; verdict: string; at: string }[] }).scans;
    expect(scans.map((s) => s.reportId)).toEqual([(again.body as ScanResponseOk).id, (first.body as ScanResponseOk).id]);
    expect(scans[0]).toMatchObject({ owner: "o", repo: "r" });
    expect(await handleScansRequest(opts, "Bearer tok-bob")).toMatchObject({ status: 200, body: { ok: true, scans: [] } });
    expect(await handleScansRequest(opts, null)).toMatchObject({ status: 401 });
    // History lines outlive the 30-day reports and go after 180 days.
    t += 181 * 86_400_000;
    await store.purgeExpired();
    expect(await store.listScans(ALICE.id, 10)).toEqual([]);
  });

  it("returns the report even when the history line cannot be written", async () => {
    const broken: ReportStore = { ...createMemoryStore(), recordScan: () => Promise.reject(new Error("db down")) };
    const r = await handleScanRequest({ url: "https://github.com/o/r" }, baseOptions(fakeGitHub(), { auth, store: broken }), "Bearer tok-alice");
    expect(r.status).toBe(200);
    const listing: ReportStore = { ...createMemoryStore(), listScans: () => Promise.reject(new Error("db down")) };
    expect(await handleScansRequest({ auth, store: listing }, "Bearer tok-alice")).toMatchObject({ status: 503, body: { error: { code: "store-unavailable" } } });
  });

  it("answers 429 with the quota when the window is exhausted, before any download", async () => {
    const gh = fakeGitHub();
    const store = createMemoryStore();
    const opts = baseOptions(gh, { auth, store, quota: { limit: 1, windowSeconds: 3600 }, cacheMs: 0 });
    expect((await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer tok-alice")).status).toBe(200);
    const r = await handleScanRequest({ url: "https://github.com/o/r/tree/main" }, opts, "Bearer tok-alice");
    expect(r).toMatchObject({ status: 429, body: { ok: false, error: { code: "rate-limited", quota: { used: 1, limit: 1 } } } });
    expect(gh.calls.filter((c) => c.includes("codeload")).length).toBe(1);
  });

  it("answers 503 when the store is unreachable instead of scanning unmetered", async () => {
    const gh = fakeGitHub();
    const broken: ReportStore = { ...createMemoryStore(), findRecent: () => Promise.reject(new Error("db down")) };
    const r = await handleScanRequest({ url: "https://github.com/o/r" }, baseOptions(gh, { auth, store: broken }), "Bearer tok-alice");
    expect(r).toMatchObject({ status: 503, body: { ok: false, error: { code: "store-unavailable" } } });
    expect(gh.calls.filter((c) => c.includes("codeload")).length).toBe(0);
  });

  it("counts known login-funnel events per day, refuses anything else, and needs no session", async () => {
    const store = createMemoryStore({ now: () => new Date("2026-10-29T10:00:00Z") });
    const opts: HandlerOptions = { auth, store };
    expect(await handleEventRequest({ kind: "login_view" }, opts)).toEqual({ status: 200, body: { ok: true } });
    expect(await handleEventRequest({ kind: "login_view" }, opts)).toEqual({ status: 200, body: { ok: true } });
    expect(await handleEventRequest({ kind: "signin_complete" }, opts)).toEqual({ status: 200, body: { ok: true } });
    for (const bad of [null, {}, { kind: "page_view" }, { kind: "login_view'; drop table events; --" }, { kind: 1 }]) {
      expect(await handleEventRequest(bad, opts)).toMatchObject({ status: 400, body: { ok: false, error: { code: "bad-request" } } });
    }
    expect(store.eventCounts()).toEqual({ "2026-10-29:login_view": 2, "2026-10-29:signin_complete": 1 });
    // Bare (local server without a store) it accepts and drops; a broken store answers 503.
    expect(await handleEventRequest({ kind: "login_start" }, {})).toEqual({ status: 200, body: { ok: true } });
    const broken: ReportStore = { ...createMemoryStore(), countEvent: () => Promise.reject(new Error("db down")) };
    expect(await handleEventRequest({ kind: "login_start" }, { store: broken })).toMatchObject({ status: 503, body: { ok: false, error: { code: "store-unavailable" } } });
  });

  it("still works bare (no auth, no store) for the local server", async () => {
    const gh = fakeGitHub();
    const r = await handleScanRequest({ url: "https://github.com/o/r" }, baseOptions(gh));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, id: null, cached: false, quota: null });
  });
});

describe("handleCleanupRequest", () => {
  it("requires the cron secret and reports how many reports were deleted", async () => {
    const store = createMemoryStore({ now: () => new Date("2026-12-01T00:00:00Z") });
    await store.save({ userId: ALICE.id, owner: "o", repo: "r", ref: null, sha: SHA, cachedFrom: null, body: {}, expiresAt: "2026-11-01T00:00:00.000Z" });
    const opts: HandlerOptions = { store };
    expect(await handleCleanupRequest(opts, null, "s3cret")).toMatchObject({ status: 401 });
    expect(await handleCleanupRequest(opts, "Bearer wrong", "s3cret")).toMatchObject({ status: 401 });
    expect(await handleCleanupRequest(opts, "Bearer s3cret", undefined)).toMatchObject({ status: 401 });
    expect(await handleCleanupRequest(opts, "Bearer s3cret", "s3cret")).toEqual({ status: 200, body: { ok: true, deleted: 1 } });
  });
});

// --- env ---------------------------------------------------------------------

describe("handlerOptionsFromEnv", () => {
  it("picks supabase, stub or nothing from the environment", () => {
    expect(authConfigFromEnv({})).toEqual({ mode: "none" });
    expect(authConfigFromEnv({ GATESEEKER_AUTH_STUB: "1" })).toEqual({ mode: "stub", token: STUB_TOKEN });
    expect(authConfigFromEnv({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon", GATESEEKER_AUTH_STUB: "1" })).toEqual({ mode: "supabase", url: "https://p.supabase.co", anonKey: "anon" });
    const bare = handlerOptionsFromEnv({ env: {} });
    expect(bare.auth).toBeUndefined();
    expect(bare.store).toBeUndefined();
    expect(bare.quota).toEqual({ limit: 10, windowSeconds: 3600 });
    const stub = handlerOptionsFromEnv({ env: { GATESEEKER_AUTH_STUB: "1", GATESEEKER_SCAN_LIMIT: "3", GITHUB_TOKEN: "ghp_x" } });
    expect(stub.quota).toEqual({ limit: 3, windowSeconds: 3600 });
    expect(stub.githubToken).toBe("ghp_x");
    expect(stub.store).toBeDefined();
    expect(() => handlerOptionsFromEnv({ env: { SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon" } })).toThrow(/SERVICE_ROLE/);
    const prod = handlerOptionsFromEnv({ env: { SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" } });
    expect(prod.auth).toBeDefined();
    expect(prod.store).toBeDefined();
  });

  it("fails closed when auth is required but not configured", async () => {
    const closed = handlerOptionsFromEnv({ env: {}, requireAuth: true });
    expect(closed.closed).toBe(true);
    const r = await handleScanRequest({ url: "https://github.com/o/r" }, { ...closed, fetch: fakeGitHub().fetch }, null);
    expect(r).toMatchObject({ status: 503, body: { ok: false, error: { code: "store-unavailable" } } });
    expect(await handleReportRequest("x", closed, "Bearer anything")).toMatchObject({ status: 503 });
    expect(handlerOptionsFromEnv({ env: { GATESEEKER_AUTH_STUB: "1" }, requireAuth: true }).closed).toBeUndefined();
  });

  it("the stub token resolves to the stub user", async () => {
    const stub = handlerOptionsFromEnv({ env: { GATESEEKER_AUTH_STUB: "1" } });
    expect(await stub.auth?.verify(STUB_TOKEN)).toEqual(STUB_USER);
    expect(await stub.auth?.verify("other")).toBeNull();
  });
});

// --- following and the daily monitor (docs/SPRINT_6.md 3.3, 3.4, tests 6 and 7) ---

describe("follows", () => {
  it("follows in lower case, validates names, enforces the limit and serves each account its own list", async () => {
    const store = createMemoryStore();
    const opts = { auth, store, followLimit: 2 };
    expect(await handleFollowsRequest("POST", { owner: "Acme", repo: "Vibe" }, opts, "Bearer tok-alice")).toMatchObject({ status: 200, body: { ok: true, follows: [{ owner: "acme", repo: "vibe", lastScanAt: null }] } });
    // Idempotent, case-insensitive.
    expect(await handleFollowsRequest("POST", { owner: "acme", repo: "vibe" }, opts, "Bearer tok-alice")).toMatchObject({ status: 200, body: { follows: [{ owner: "acme" }] } });
    expect(await handleFollowsRequest("POST", { owner: "-bad-", repo: "x" }, opts, "Bearer tok-alice")).toMatchObject({ status: 400, body: { error: { code: "invalid-url" } } });
    expect(await handleFollowsRequest("POST", { owner: "o" }, opts, "Bearer tok-alice")).toMatchObject({ status: 400, body: { error: { code: "bad-request" } } });
    await handleFollowsRequest("POST", { owner: "o", repo: "two" }, opts, "Bearer tok-alice");
    expect(await handleFollowsRequest("POST", { owner: "o", repo: "three" }, opts, "Bearer tok-alice")).toMatchObject({ status: 429, body: { error: { message: expect.stringContaining("up to 2") as string } } });
    expect(await handleFollowsRequest("GET", null, opts, "Bearer tok-bob")).toMatchObject({ status: 200, body: { follows: [] } });
    expect(await handleFollowsRequest("GET", null, opts, null)).toMatchObject({ status: 401 });
    expect(await handleFollowsRequest("DELETE", { owner: "ACME", repo: "vibe" }, opts, "Bearer tok-alice")).toMatchObject({ status: 200, body: { follows: [{ owner: "o", repo: "two" }] } });
  });
});

describe("follow queue (memory store)", () => {
  it("puts queued follows first, then never-scanned, then oldest, and skips paused ones", async () => {
    const store = createMemoryStore();
    for (const repo of ["a", "b", "c", "d"]) await store.follow(ALICE.id, "o", repo, 10);
    const [a, b, c, d] = await store.listFollows(ALICE.id);
    await store.updateFollow(a?.id ?? "", { lastScanAt: "2026-11-01T00:00:00.000Z", ecosystems: ["npm"] });
    await store.updateFollow(b?.id ?? "", { lastScanAt: "2026-11-02T00:00:00.000Z", ecosystems: ["Packagist"] });
    await store.updateFollow(d?.id ?? "", { lastScanAt: "2026-11-02T00:00:00.000Z", ecosystems: ["Packagist"], pausedReason: "gone" });
    expect(await store.queueFollows(["Packagist"], "2026-11-02T12:00:00.000Z")).toBe(1);
    const due = await store.dueFollows("2026-11-01T12:00:00.000Z", 10);
    expect(due.map((f) => f.repo)).toEqual(["b", "c", "a"]);
    expect(due.map((f) => f.id)).not.toContain(d?.id);
    expect(c?.ecosystems).toBeNull();
  });
});

describe("daily monitor", () => {
  const CLEAN = targz({ "r-bbbb/package.json": '{"name":"r"}' });
  const secret = "cron-secret";

  async function followed(store: ReturnType<typeof createMemoryStore>) {
    await handleFollowsRequest("POST", { owner: "o", repo: "r" }, { auth, store }, "Bearer tok-alice");
  }

  it("needs the cron secret", async () => {
    expect(await handleMonitorRequest({ store: createMemoryStore() }, "Bearer nope", secret)).toMatchObject({ status: 401 });
    expect(await handleMonitorRequest({ store: createMemoryStore() }, `Bearer ${secret}`, undefined)).toMatchObject({ status: 401 });
  });

  it("takes a baseline first, waits a day, then reports new urgent findings against the previous rescan", async () => {
    let t = Date.parse("2026-11-01T06:00:00Z");
    const now = () => new Date(t);
    const store = createMemoryStore({ now });
    await followed(store);
    let archive = CLEAN;
    const gh = { fetch: ((input: string | URL | Request, init?: RequestInit) => fakeGitHub(archive).fetch(input, init)) as typeof fetch };
    const opts = { ...baseOptions(gh as ReturnType<typeof fakeGitHub>), store, now, cacheMs: 0 };

    const first = await handleMonitorRequest(opts, `Bearer ${secret}`, secret);
    expect(first).toMatchObject({ status: 200, body: { checked: 1, withNewUrgent: 0, failed: 0 } });
    const [baseline] = await store.listFollows(ALICE.id);
    expect(baseline).toMatchObject({ lastNewUrgent: 0, failures: 0, lastVerdict: "pass" });
    const baselineId = baseline?.lastReportId;
    expect(baselineId).toBeTruthy();
    expect(await store.listScans(ALICE.id, 10)).toHaveLength(1);

    // Same day: nothing is due.
    expect(await handleMonitorRequest(opts, `Bearer ${secret}`, secret)).toMatchObject({ body: { checked: 0 } });

    // Next day the repository gained a wildcard CORS with credentials (P1).
    t += 21 * 3_600_000;
    archive = ARCHIVE;
    expect(await handleMonitorRequest(opts, `Bearer ${secret}`, secret)).toMatchObject({ status: 200, body: { checked: 1, withNewUrgent: 1 } });
    const [after] = await store.listFollows(ALICE.id);
    expect(after?.lastNewUrgent).toBe(1);
    expect(after?.lastReportId).not.toBe(baselineId);
  });

  it("pauses a repository that disappeared and counts passing failures", async () => {
    const store = createMemoryStore();
    await followed(store);
    // eslint-disable-next-line @typescript-eslint/require-await
    const gone = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    expect(await handleMonitorRequest({ ...baseOptions({ fetch: gone, calls: [] }), store }, `Bearer ${secret}`, secret)).toMatchObject({ body: { checked: 1, paused: 1 } });
    expect((await store.listFollows(ALICE.id))[0]?.pausedReason).toContain("not found");
    // Paused follows are not due any more.
    expect(await store.dueFollows("2999-01-01T00:00:00.000Z", 10)).toEqual([]);

    const store2 = createMemoryStore();
    await followed(store2);
    const broken = fakeGitHub(Buffer.from("not a tarball"));
    expect(await handleMonitorRequest({ ...baseOptions(broken), store: store2 }, `Bearer ${secret}`, secret)).toMatchObject({ body: { checked: 1, failed: 1 } });
    expect((await store2.listFollows(ALICE.id))[0]).toMatchObject({ failures: 1, pausedReason: null });
  });

  it("stops before the time budget runs out and leaves the rest for the next call", async () => {
    const store = createMemoryStore();
    await handleFollowsRequest("POST", { owner: "o", repo: "one" }, { auth, store }, "Bearer tok-alice");
    await handleFollowsRequest("POST", { owner: "o", repo: "two" }, { auth, store }, "Bearer tok-alice");
    let clock = 0;
    const gh = fakeGitHub(CLEAN);
    const slow = { fetch: ((input: string | URL | Request, init?: RequestInit) => { clock += 25_000; return gh.fetch(input, init); }) as typeof fetch, calls: [] };
    const r = await handleMonitorRequest({ ...baseOptions(slow), store, budgetMs: 100_000, reserveMs: 60_000, clock: () => clock }, `Bearer ${secret}`, secret);
    expect(r).toMatchObject({ status: 200, body: { checked: 1, remaining: 1 } });
  });
});

// --- curated feed without a redeploy (docs/SPRINT_6.md 3.5, test 5) ---------

describe("published advisory feed", () => {
  const KEY = "k".repeat(32);
  const T0 = Date.parse("2026-11-02T12:00:00Z");
  // The real approved records (never invented ones): the first set leaves the Packagist record out, the second adds it.
  const approved = readdirSync(join(process.cwd(), "advisories", "approved"))
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(join(process.cwd(), "advisories", "approved", n), "utf8")) as { id: string; ecosystem: string });
  const withoutPackagist = JSON.stringify(approved.filter((a) => a.ecosystem !== "Packagist"));
  const everything = JSON.stringify(approved);

  function signed(payload: string, at: number, key = KEY) {
    const publishedAt = new Date(at).toISOString();
    const digest = advisorySetFromText(payload, "test").digest;
    return { publishedAt, digest, payload, signature: signFeed(key, publishedAt, digest, payload) };
  }

  it("has a Packagist record and another one to work with", () => {
    expect(approved.some((a) => a.ecosystem === "Packagist")).toBe(true);
    expect(approved.some((a) => a.ecosystem !== "Packagist")).toBe(true);
  });

  it("refuses a set without the key, with a wrong signature, stale, replayed, with invalid records or a wrong digest", async () => {
    const store = createMemoryStore();
    const now = () => new Date(T0);
    const opts = { store, now, feedKey: KEY };
    const good = signed(withoutPackagist, T0);
    expect(await handleFeedPublishedRequest(good, { store, now })).toMatchObject({ status: 401 });
    expect(await handleFeedPublishedRequest({ ...good, signature: signed(withoutPackagist, T0, "x".repeat(32)).signature }, opts)).toMatchObject({ status: 401, body: { error: { message: "Signature missing or wrong." } } });
    expect(await handleFeedPublishedRequest(signed(withoutPackagist, T0 - 11 * 60_000), opts)).toMatchObject({ status: 401, body: { error: { message: expect.stringContaining("too old") as string } } });
    expect(await handleFeedPublishedRequest({ publishedAt: good.publishedAt }, opts)).toMatchObject({ status: 400 });
    const invalid = JSON.stringify([{ id: "not-a-record" }]);
    expect(await handleFeedPublishedRequest(signed(invalid, T0), opts)).toMatchObject({ status: 400, body: { error: { message: expect.stringContaining("invalid records") as string } } });
    const lying = { ...good, digest: "0".repeat(16) };
    expect(await handleFeedPublishedRequest({ ...lying, signature: signFeed(KEY, lying.publishedAt, lying.digest, lying.payload) }, opts)).toMatchObject({ status: 400, body: { error: { message: expect.stringContaining("digest") as string } } });
    expect(await store.latestFeed()).toBeNull();
    expect(await handleFeedPublishedRequest(good, opts)).toMatchObject({ status: 200, body: { changed: true } });
    // The same signed body sent again cannot roll the feed back or repeat the queue.
    expect(await handleFeedPublishedRequest(good, opts)).toMatchObject({ status: 400, body: { error: { message: expect.stringContaining("already stored") as string } } });
  });

  it("stores the set, queues only the follows of the ecosystems that changed and rescans them right away", async () => {
    let t = T0;
    const now = () => new Date(t);
    const store = createMemoryStore({ now });
    await handleFollowsRequest("POST", { owner: "o", repo: "r" }, { auth, store }, "Bearer tok-alice");
    await handleFollowsRequest("POST", { owner: "o", repo: "npm-only" }, { auth, store }, "Bearer tok-alice");
    const [php, js] = await store.listFollows(ALICE.id);
    await store.updateFollow(php?.id ?? "", { lastScanAt: now().toISOString(), ecosystems: ["Packagist"] });
    await store.updateFollow(js?.id ?? "", { lastScanAt: now().toISOString(), ecosystems: ["npm"] });
    const opts = { ...baseOptions(fakeGitHub(targz({ "r-bbbb/package.json": '{"name":"r"}' }))), store, now, feedKey: KEY };

    // First set: nothing to compare with, so its ecosystems count as changed; no follow uses them.
    const first = await handleFeedPublishedRequest(signed(withoutPackagist, t), opts);
    expect(first).toMatchObject({ status: 200, body: { changed: true, queued: 0, monitor: { checked: 0 } } });

    // Same records again, signed later (a re-run of the workflow): nothing stored, nothing queued.
    t += 60_000;
    expect(await handleFeedPublishedRequest(signed(withoutPackagist, t), opts)).toMatchObject({ status: 200, body: { changed: false, queued: 0 } });

    // A new Packagist record: only the Packagist follow is queued and rescanned now, though it was checked minutes ago.
    t += 60_000;
    const second = await handleFeedPublishedRequest(signed(everything, t), opts);
    expect(second).toMatchObject({ status: 200, body: { changed: true, ecosystems: ["Packagist"], queued: 1, monitor: { checked: 1 } } });
    const after = await store.listFollows(ALICE.id);
    expect(after.find((f) => f.repo === "r")).toMatchObject({ queuedAt: null, lastScanAt: now().toISOString() });
    expect(after.find((f) => f.repo === "npm-only")?.lastScanAt).toBe(new Date(T0).toISOString());
    expect((await store.latestFeed())?.digest).toBe(advisorySetFromText(everything, "x").digest);
  });

  it("scans with the published set, says so in the report, and does not reuse a report made with another set", async () => {
    let t = T0;
    const now = () => new Date(t);
    const store = createMemoryStore({ now });
    const lock = JSON.stringify({ name: "r", lockfileVersion: 3, packages: { "": { name: "r" } } });
    const gh = fakeGitHub(targz({ "r-bbbb/package.json": '{"name":"r"}', "r-bbbb/package-lock.json": lock }));
    const opts = { ...baseOptions(gh), auth, store, now, feedKey: KEY };
    const sourceOf = (r: Awaited<ReturnType<typeof handleScanRequest>>) => (r.body as ScanResponseOk).report.sources.find((s) => s.name === "gateseeker-advisories")?.endpoint ?? "";

    const before = await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer tok-alice");
    expect(sourceOf(before)).toMatch(/^(bundled|checkout:advisories\/approved) /);

    await handleFeedPublishedRequest(signed(withoutPackagist, t), opts);
    t += 60_000;
    const after = await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer tok-alice");
    expect(after.body).toMatchObject({ cached: false });
    expect(sourceOf(after)).toContain(`published ${new Date(T0).toISOString()}`);

    // Same commit, same set: reused.
    expect((await handleScanRequest({ url: "https://github.com/o/r" }, opts, "Bearer tok-alice")).body).toMatchObject({ cached: true });
  });

  it("falls back to the bundled set and says why when the stored set was tampered with or the database fails", async () => {
    const now = () => new Date(T0);
    const store = createMemoryStore({ now });
    const good = signed(withoutPackagist, T0);
    await store.saveFeed({ ...good, payload: everything });
    const tampered = await currentAdvisories({ store, now, feedKey: KEY });
    expect(tampered.origin).not.toMatch(/^published/);
    expect(tampered.problems.join(" ")).toContain("failed signature verification");

    const down: ReportStore = { ...createMemoryStore(), latestFeed: () => Promise.reject(new Error("db down")) };
    const fallback = await currentAdvisories({ store: down, now, feedKey: KEY });
    expect(fallback.origin).not.toMatch(/^published/);
    expect(fallback.problems.join(" ")).toContain("could not be read");

    // Without the key the service never reads the database.
    let read = false;
    const spy: ReportStore = { ...createMemoryStore(), latestFeed: () => { read = true; return Promise.resolve(null); } };
    await currentAdvisories({ store: spy, now });
    expect(read).toBe(false);
  });

  it("reads the key from GATESEEKER_FEED_KEY only when it is long enough", () => {
    expect(handlerOptionsFromEnv({ env: { GATESEEKER_FEED_KEY: KEY } }).feedKey).toBe(KEY);
    expect(handlerOptionsFromEnv({ env: { GATESEEKER_FEED_KEY: "short" } }).feedKey).toBeUndefined();
  });
});

// --- email alerts and unsubscribe (docs/SPRINT_6.md 3.6, 3.7, tests 2, 3, 4, 7) ---

describe("email alerts", () => {
  const MAIL_KEY = "m".repeat(32);
  const SECRET = "cron-secret";
  const CLEAN = targz({ "r-bbbb/package.json": '{"name":"r"}' });

  function mailFor(extra: Partial<MailSettings> = {}) {
    const mailer = createMemoryMailer();
    const mail: MailSettings = { mailer, directory: createStaticDirectory({ [ALICE.id]: "alice@example.test" }), key: MAIL_KEY, baseUrl: "https://gateseeker.example", dailyCap: 50, ...extra };
    return { mailer, mail };
  }

  /** A GitHub double whose archive and OSV answers can change between rescans. */
  function switchable(initial: Buffer) {
    const state = { archive: initial, osvDown: false };
    const f = ((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (state.osvDown && url.includes("osv.dev")) return Promise.resolve(new Response("down", { status: 500 }));
      return fakeGitHub(state.archive).fetch(input, init);
    }) as typeof fetch;
    return { state, gh: { fetch: f, calls: [] as string[] } };
  }

  async function monitor(opts: HandlerOptions) {
    return handleMonitorRequest(opts, `Bearer ${SECRET}`, SECRET);
  }

  it("emails a confirmation only when the follow is new", async () => {
    const store = createMemoryStore();
    const { mailer, mail } = mailFor();
    const opts = { auth, store, mail };
    await handleFollowsRequest("POST", { owner: "o", repo: "r" }, opts, "Bearer tok-alice");
    await handleFollowsRequest("POST", { owner: "O", repo: "R" }, opts, "Bearer tok-alice");
    expect(mailer.sent.map((m) => [m.kind, m.to])).toEqual([["follow_confirm", "alice@example.test"]]);
    expect(mailer.sent[0]?.subject).toBe("You follow o/r on Gateseeker");
    expect(store.eventCounts()).toMatchObject({ [`${new Date().toISOString().slice(0, 10)}:email_follow_confirm`]: 1 });
  });

  it("alerts once per repository per day, only for new P1/P2 findings, and sends what waited the next day", async () => {
    let t = Date.parse("2026-11-03T06:00:00Z");
    const now = () => new Date(t);
    const store = createMemoryStore({ now });
    const { mailer, mail } = mailFor();
    const { state, gh } = switchable(CLEAN);
    const opts = { ...baseOptions(gh), auth, store, now, mail, cacheMs: 0 };
    await handleFollowsRequest("POST", { owner: "o", repo: "r" }, opts, "Bearer tok-alice");

    // Baseline: no alert.
    await monitor(opts);
    expect(mailer.sent.map((m) => m.kind)).toEqual(["follow_confirm"]);

    // Next day: a wildcard CORS with credentials (P1) appears.
    t += 21 * 3_600_000;
    state.archive = ARCHIVE;
    expect(await monitor(opts)).toMatchObject({ body: { checked: 1, withNewUrgent: 1 } });
    const first = mailer.sent[1];
    expect(first?.kind).toBe("alert");
    expect(first?.subject).toBe("o/r: 1 new finding to fix soon");
    expect(first?.text).toMatch(/P1 · GSK-[A-Z-]+\d+ · /);
    expect((await store.listFollows(ALICE.id))[0]).toMatchObject({ pendingAlert: null, lastAlertAt: now().toISOString() });

    // Same day, a queued rescan finds another one: it waits, no second email today.
    t += 3_600_000;
    state.archive = targz({ "r-bbbb/package.json": '{"name":"r"}', "r-bbbb/src/server.ts": 'app.use(cors({ origin: "*", credentials: true }));\n', "r-bbbb/src/admin.ts": 'app.use(cors({ origin: "*", credentials: true }));\n' });
    const [f] = await store.listFollows(ALICE.id);
    await store.updateFollow(f?.id ?? "", { queuedAt: now().toISOString() });
    expect(await monitor(opts)).toMatchObject({ body: { checked: 1, withNewUrgent: 1 } });
    expect(mailer.sent).toHaveLength(2);
    expect((await store.listFollows(ALICE.id))[0]?.pendingAlert).toMatchObject({ count: 1 });

    // Next day, nothing new, but the waiting alert goes out.
    t += 21 * 3_600_000;
    await monitor(opts);
    expect(mailer.sent.map((m) => m.kind)).toEqual(["follow_confirm", "alert", "alert"]);
    expect(mailer.sent[2]?.text).toContain("1 new finding to fix soon");
    expect((await store.listFollows(ALICE.id))[0]?.pendingAlert).toBeNull();
  });

  it("never alerts from an incomplete rescan", async () => {
    let t = Date.parse("2026-11-03T06:00:00Z");
    const now = () => new Date(t);
    const store = createMemoryStore({ now });
    const { mailer, mail } = mailFor();
    const lock = JSON.stringify({ name: "r", lockfileVersion: 3, packages: { "": { name: "r" }, "node_modules/left-pad": { version: "1.3.0" } } });
    const { state, gh } = switchable(targz({ "r-bbbb/package.json": '{"name":"r"}', "r-bbbb/package-lock.json": lock }));
    const opts = { ...baseOptions(gh), auth, store, now, mail, cacheMs: 0 };
    await handleFollowsRequest("POST", { owner: "o", repo: "r" }, opts, "Bearer tok-alice");
    await monitor(opts);
    t += 21 * 3_600_000;
    state.archive = targz({ "r-bbbb/package.json": '{"name":"r"}', "r-bbbb/package-lock.json": lock, "r-bbbb/src/server.ts": 'app.use(cors({ origin: "*", credentials: true }));\n' });
    state.osvDown = true;
    expect(await monitor(opts)).toMatchObject({ body: { checked: 1, failed: 1 } });
    expect(mailer.sent.map((m) => m.kind)).toEqual(["follow_confirm"]);
    expect((await store.listFollows(ALICE.id))[0]).toMatchObject({ lastVerdict: "incomplete", pendingAlert: null });
    expect(store.eventCounts()).toMatchObject({ [`${now().toISOString().slice(0, 10)}:rescan_incomplete`]: 1 });
  });

  it("keeps the alert for later when the daily cap is reached, and counts it", async () => {
    let t = Date.parse("2026-11-03T06:00:00Z");
    const now = () => new Date(t);
    const store = createMemoryStore({ now });
    const { mailer, mail } = mailFor({ dailyCap: 0 });
    const { state, gh } = switchable(CLEAN);
    const opts = { ...baseOptions(gh), auth, store, now, mail, cacheMs: 0 };
    await handleFollowsRequest("POST", { owner: "o", repo: "r" }, opts, "Bearer tok-alice");
    await monitor(opts);
    t += 21 * 3_600_000;
    state.archive = ARCHIVE;
    await monitor(opts);
    expect(mailer.sent).toEqual([]);
    expect((await store.listFollows(ALICE.id))[0]?.pendingAlert).toMatchObject({ count: 1 });
    expect(store.eventCounts()[`${now().toISOString().slice(0, 10)}:email_capped`]).toBe(1);
  });

  it("sends one notice when monitoring pauses", async () => {
    const store = createMemoryStore();
    const { mailer, mail } = mailFor();
    await handleFollowsRequest("POST", { owner: "o", repo: "r" }, { auth, store, mail }, "Bearer tok-alice");
    const gone = (() => Promise.resolve(new Response("{}", { status: 404 }))) as typeof fetch;
    const opts = { ...baseOptions({ fetch: gone, calls: [] }), store, mail };
    await monitor(opts);
    await monitor(opts);
    expect(mailer.sent.map((m) => m.kind)).toEqual(["follow_confirm", "paused"]);
    expect(mailer.sent[1]?.text).toContain("The repository was not found on GitHub.");
  });

  it("sends nothing when email is off or the account has no address, and drops the alert", async () => {
    for (const mail of [mailFor({ mailer: null }).mail, mailFor({ directory: createStaticDirectory({}) }).mail]) {
      let t = Date.parse("2026-11-03T06:00:00Z");
      const now = () => new Date(t);
      const store = createMemoryStore({ now });
      const { state, gh } = switchable(CLEAN);
      const opts = { ...baseOptions(gh), auth, store, now, mail, cacheMs: 0 };
      await handleFollowsRequest("POST", { owner: "o", repo: "r" }, opts, "Bearer tok-alice");
      await monitor(opts);
      t += 21 * 3_600_000;
      state.archive = ARCHIVE;
      await monitor(opts);
      expect((await store.listFollows(ALICE.id))[0]).toMatchObject({ lastNewUrgent: 1, pendingAlert: null, lastAlertAt: null });
    }
  });

  it("puts no credential and no code from the scanned project in the alert", async () => {
    const root = fixturePath("projects/vibe-next-supabase");
    const files: Record<string, string> = {};
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else files[`r-bbbb/${relative(root, full).replace(/\\/g, "/")}`] = readFileSync(full, "utf8");
      }
    };
    walk(root);
    let t = Date.parse("2026-11-03T06:00:00Z");
    const now = () => new Date(t);
    const store = createMemoryStore({ now });
    const { mailer, mail } = mailFor();
    const { state, gh } = switchable(CLEAN);
    const opts = { ...baseOptions(gh), auth, store, now, mail, cacheMs: 0 };
    await handleFollowsRequest("POST", { owner: "o", repo: "r" }, opts, "Bearer tok-alice");
    await monitor(opts);
    t += 21 * 3_600_000;
    state.archive = targz(files);
    await monitor(opts);
    const alertMessage = mailer.sent.find((m) => m.kind === "alert");
    expect(alertMessage).toBeDefined();
    const content = `${alertMessage?.subject ?? ""}\n${alertMessage?.text ?? ""}\n${alertMessage?.html ?? ""}`;
    expect(content).toContain("GSK-SECRET-001");
    for (const [name, value] of Object.entries(readJsonFixture("projects/secrets.json") as Record<string, string>)) {
      expect(content, `secret ${name} reached the email`).not.toContain(value);
    }
    const report = await store.get((await store.listFollows(ALICE.id))[0]?.lastReportId ?? "", ALICE.id);
    const snippets = (report?.body as ScanResponseOk).report.findings.flatMap((f) => (f.evidence.kind === "insecure-pattern" ? [f.evidence.snippet, f.evidence.file] : []));
    expect(snippets.length).toBeGreaterThan(0);
    for (const s of snippets) if (s.length >= 8) expect(content, `code or path "${s}" reached the email`).not.toContain(s);
  });
});

describe("unsubscribe", () => {
  const MAIL_KEY = "m".repeat(32);

  it("stops only the follow in the link, without a session; a repeat is fine; a tampered token is refused", async () => {
    const store = createMemoryStore();
    const mailer = createMemoryMailer();
    const mail: MailSettings = { mailer, directory: createStaticDirectory({ [ALICE.id]: "alice@example.test" }), key: MAIL_KEY, baseUrl: "https://gateseeker.example", dailyCap: 50 };
    await handleFollowsRequest("POST", { owner: "o", repo: "one" }, { auth, store, mail }, "Bearer tok-alice");
    await handleFollowsRequest("POST", { owner: "o", repo: "two" }, { auth, store, mail }, "Bearer tok-alice");
    // The link of the first confirmation email.
    const link = new URL(/https:\/\/gateseeker\.example\/unsubscribe\?\S+/.exec(mailer.sent[0]?.text ?? "")?.[0] ?? "");
    const input = { f: link.searchParams.get("f"), t: link.searchParams.get("t") };
    expect(await handleUnsubscribeRequest({ ...input, t: "0".repeat(32) }, { store, mail })).toMatchObject({ status: 400 });
    expect(await handleUnsubscribeRequest({ f: input.f }, { store, mail })).toMatchObject({ status: 400 });
    expect(await handleUnsubscribeRequest(input, { store, mail })).toMatchObject({ status: 200, body: { ok: true, repository: "o/one" } });
    expect((await store.listFollows(ALICE.id)).map((f) => f.repo)).toEqual(["two"]);
    expect(await handleUnsubscribeRequest(input, { store, mail })).toMatchObject({ status: 200, body: { repository: null } });
    expect(await handleUnsubscribeRequest(input, { store })).toMatchObject({ status: 404 });
    expect(store.eventCounts()[`${new Date().toISOString().slice(0, 10)}:unsubscribe`]).toBe(1);
  });

  it("accepts the email click from the page and refuses the counters only the service keeps", async () => {
    const store = createMemoryStore();
    expect(await handleEventRequest({ kind: "email_click" }, { store })).toMatchObject({ status: 200 });
    expect(await handleEventRequest({ kind: "email_alert" }, { store })).toMatchObject({ status: 400 });
    expect(await handleEventRequest({ kind: "unsubscribe" }, { store })).toMatchObject({ status: 400 });
  });

  it("reads the email settings from the environment", () => {
    const supa = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x" };
    expect(handlerOptionsFromEnv({ env: { ...supa, GATESEEKER_EMAIL_KEY: "short" } }).mail).toBeUndefined();
    expect(handlerOptionsFromEnv({ env: { ...supa, GATESEEKER_EMAIL_KEY: MAIL_KEY } }).mail).toMatchObject({ mailer: null, key: MAIL_KEY, baseUrl: "https://gateseeker.vercel.app", dailyCap: 250 });
    const full = handlerOptionsFromEnv({ env: { ...supa, GATESEEKER_EMAIL_KEY: MAIL_KEY, BREVO_API_KEY: "xkeysib", GATESEEKER_EMAIL_FROM: "alerts@gateseeker.example", GATESEEKER_PUBLIC_URL: "https://gateseeker.example/path", GATESEEKER_EMAIL_DAILY_CAP: "100" } }).mail;
    expect(full?.mailer).not.toBeNull();
    expect(full).toMatchObject({ baseUrl: "https://gateseeker.example", dailyCap: 100 });
    expect(handlerOptionsFromEnv({ env: { ...supa, GATESEEKER_EMAIL_KEY: MAIL_KEY, BREVO_API_KEY: "xkeysib", GATESEEKER_EMAIL_FROM: "not an address", GATESEEKER_PUBLIC_URL: "http://evil.example", GATESEEKER_EMAIL_DAILY_CAP: "5000" } }).mail).toMatchObject({ mailer: null, baseUrl: "https://gateseeker.vercel.app", dailyCap: 250 });
    expect(handlerOptionsFromEnv({ env: { GATESEEKER_AUTH_STUB: "1" } }).mail).toMatchObject({ baseUrl: "http://localhost:4320" });
  });
});

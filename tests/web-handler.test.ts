import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { bearerToken, createStaticAuth, createSupabaseAuth } from "../src/web/auth.js";
import { authConfigFromEnv, handlerOptionsFromEnv, STUB_TOKEN, STUB_USER } from "../src/web/env.js";
import { handleCleanupRequest, handleReportRequest, handleScanRequest, type HandlerOptions, type ScanResponseOk } from "../src/web/handler.js";
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

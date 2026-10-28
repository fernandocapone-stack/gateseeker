import { z } from "zod";

/**
 * Persistence for the hosted service: saved reports (30-day retention), the
 * per-user scan quota and the per-commit cache. Two implementations: in
 * memory (local server, browser tests) and Supabase through PostgREST with
 * the service_role key (production). `fetch` is injected in the latter.
 *
 * Nothing here interprets report content; it is stored and returned as the
 * JSON the handler produced, which already went through redaction.
 */

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
  resetAt: string;
}

export interface StoredReport {
  id: string;
  userId: string;
  owner: string;
  repo: string;
  ref: string | null;
  sha: string;
  cachedFrom: string | null;
  body: unknown;
  createdAt: string;
  expiresAt: string;
}

export type NewReport = Omit<StoredReport, "id" | "createdAt">;

export interface ReportStore {
  claimQuota(userId: string, limit: number, windowSeconds: number): Promise<QuotaDecision>;
  /** Most recent report for this commit not older than `maxAgeMs`, from any user (public repositories give everyone the same report). */
  findRecent(owner: string, repo: string, sha: string, maxAgeMs: number): Promise<StoredReport | null>;
  save(report: NewReport): Promise<string>;
  /** A report by id, only when `userId` owns it. */
  get(id: string, userId: string): Promise<StoredReport | null>;
  /** Deletes reports past their `expiresAt`; returns how many. */
  purgeExpired(): Promise<number>;
}

export interface StoreClock {
  now?: () => Date;
}

export function createMemoryStore(clock: StoreClock = {}): ReportStore {
  const now = clock.now ?? (() => new Date());
  const reports = new Map<string, StoredReport>();
  const quota = new Map<string, { windowStart: number; used: number }>();
  let seq = 0;
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    async claimQuota(userId, limit, windowSeconds) {
      const t = now().getTime();
      const windowMs = windowSeconds * 1000;
      let q = quota.get(userId);
      if (!q || q.windowStart + windowMs <= t) q = { windowStart: t, used: 0 };
      const resetAt = new Date(q.windowStart + windowMs).toISOString();
      if (q.used >= limit) {
        quota.set(userId, q);
        return { allowed: false, used: q.used, limit, resetAt };
      }
      q.used += 1;
      quota.set(userId, q);
      return { allowed: true, used: q.used, limit, resetAt };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async findRecent(owner, repo, sha, maxAgeMs) {
      const t = now().getTime();
      let best: StoredReport | null = null;
      for (const r of reports.values()) {
        if (r.owner !== owner || r.repo !== repo || r.sha !== sha) continue;
        if (t - Date.parse(r.createdAt) > maxAgeMs) continue;
        if (!best || r.createdAt > best.createdAt) best = r;
      }
      return best;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async save(report) {
      seq += 1;
      const id = `mem-${seq.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      reports.set(id, { ...report, id, createdAt: now().toISOString() });
      return id;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async get(id, userId) {
      const r = reports.get(id);
      return r?.userId === userId ? r : null;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async purgeExpired() {
      const t = now().getTime();
      let n = 0;
      for (const [id, r] of reports) {
        if (Date.parse(r.expiresAt) < t) {
          reports.delete(id);
          n += 1;
        }
      }
      return n;
    },
  };
}

export interface SupabaseStoreOptions {
  url: string;
  serviceKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

const rowSchema = z.looseObject({
  id: z.string(),
  user_id: z.string(),
  owner: z.string(),
  repo: z.string(),
  ref: z.string().nullable(),
  sha: z.string(),
  cached_from: z.string().nullable(),
  body: z.unknown(),
  created_at: z.string(),
  expires_at: z.string(),
});

const quotaSchema = z.looseObject({ allowed: z.boolean(), used: z.number(), limit: z.number(), reset_at: z.string() });

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

function toStored(row: z.infer<typeof rowSchema>): StoredReport {
  return { id: row.id, userId: row.user_id, owner: row.owner, repo: row.repo, ref: row.ref, sha: row.sha, cachedFrom: row.cached_from, body: row.body, createdAt: row.created_at, expiresAt: row.expires_at };
}

/** Supabase (PostgREST) implementation with the service_role key; the key never leaves the server. */
export function createSupabaseStore(options: SupabaseStoreOptions): ReportStore {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const base = options.url.replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const headers = { apikey: options.serviceKey, authorization: `Bearer ${options.serviceKey}`, "content-type": "application/json" };

  async function call(path: string, init: { method: string; body?: string; prefer?: string }): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: init.method,
        ...(init.body !== undefined ? { body: init.body } : {}),
        headers: { ...headers, ...(init.prefer ? { prefer: init.prefer } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new StoreError(`Supabase unreachable: ${(e as Error).message}`, null);
    }
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) throw new StoreError(`Supabase answered HTTP ${res.status}`, res.status);
    if (text === "") return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new StoreError("Supabase answered with a non-JSON body", res.status);
    }
  }

  return {
    async claimQuota(userId, limit, windowSeconds) {
      const out = await call("/rest/v1/rpc/claim_scan", { method: "POST", body: JSON.stringify({ p_user: userId, p_limit: limit, p_window_seconds: windowSeconds }) });
      const parsed = quotaSchema.safeParse(out);
      if (!parsed.success) throw new StoreError("claim_scan returned an unexpected shape", 200);
      return { allowed: parsed.data.allowed, used: parsed.data.used, limit: parsed.data.limit, resetAt: parsed.data.reset_at };
    },
    async findRecent(owner, repo, sha, maxAgeMs) {
      const since = new Date(now().getTime() - maxAgeMs).toISOString();
      const q = new URLSearchParams({ owner: `eq.${owner}`, repo: `eq.${repo}`, sha: `eq.${sha}`, created_at: `gte.${since}`, order: "created_at.desc", limit: "1" });
      const out = await call(`/rest/v1/reports?${q.toString()}`, { method: "GET" });
      const parsed = z.array(rowSchema).safeParse(out);
      if (!parsed.success) throw new StoreError("reports query returned an unexpected shape", 200);
      const row = parsed.data[0];
      return row ? toStored(row) : null;
    },
    async save(report) {
      const row = { user_id: report.userId, owner: report.owner, repo: report.repo, ref: report.ref, sha: report.sha, cached_from: report.cachedFrom, body: report.body, expires_at: report.expiresAt };
      const out = await call("/rest/v1/reports?select=id", { method: "POST", body: JSON.stringify(row), prefer: "return=representation" });
      const parsed = z.array(z.looseObject({ id: z.string() })).safeParse(out);
      const id = parsed.success ? parsed.data[0]?.id : undefined;
      if (id === undefined) throw new StoreError("insert did not return an id", 201);
      return id;
    },
    async get(id, userId) {
      if (!ID.test(id)) return null;
      const q = new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${userId}`, limit: "1" });
      const out = await call(`/rest/v1/reports?${q.toString()}`, { method: "GET" });
      const parsed = z.array(rowSchema).safeParse(out);
      if (!parsed.success) throw new StoreError("reports query returned an unexpected shape", 200);
      const row = parsed.data[0];
      return row ? toStored(row) : null;
    },
    async purgeExpired() {
      const q = new URLSearchParams({ expires_at: `lt.${now().toISOString()}`, select: "id" });
      const out = await call(`/rest/v1/reports?${q.toString()}`, { method: "DELETE", prefer: "return=representation" });
      const parsed = z.array(z.unknown()).safeParse(out);
      return parsed.success ? parsed.data.length : 0;
    },
  };
}

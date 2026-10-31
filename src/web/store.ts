import { z } from "zod";

import type { SignedFeed } from "../intel/feed-signature.js";
import type { PendingAlert } from "./emails.js";

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

/** History line: what the Dashboard and Scans show, without the report body (which expires sooner). */
export interface ScanSummary {
  id: string;
  userId: string;
  owner: string;
  repo: string;
  sha: string;
  verdict: "pass" | "fail" | "incomplete";
  byPriority: { P1: number; P2: number; P3: number; P4: number };
  reportId: string | null;
  createdAt: string;
}

export type NewScanSummary = Omit<ScanSummary, "id" | "createdAt">;

export const SCAN_HISTORY_DAYS = 180;

/** A repository an account follows (docs/SPRINT_6.md 3.3): what the daily monitor checks and what it found last. */
export interface FollowRecord {
  id: string;
  userId: string;
  owner: string;
  repo: string;
  createdAt: string;
  lastScanAt: string | null;
  lastReportId: string | null;
  lastVerdict: "pass" | "fail" | "incomplete" | null;
  /** New P1/P2 findings in the last rescan compared with the one before (what an alert email would report). */
  lastNewUrgent: number;
  /** Rescans in a row that could not complete. */
  failures: number;
  /** Set when monitoring stopped (the repository became private or was deleted). */
  pausedReason: string | null;
  /** Ecosystems of the repository at its last rescan ("npm", "Packagist"); null before the first. */
  ecosystems: string[] | null;
  /** Set when a newly published advisory for one of its ecosystems put it in front of the daily order (docs/SPRINT_6.md 3.4). */
  queuedAt: string | null;
  /** Alert waiting to be sent (one email per repository per day, under the daily cap). */
  pendingAlert: PendingAlert | null;
  lastAlertAt: string | null;
}

export type FollowPatch = Partial<Pick<FollowRecord, "lastScanAt" | "lastReportId" | "lastVerdict" | "lastNewUrgent" | "failures" | "pausedReason" | "ecosystems" | "queuedAt" | "pendingAlert" | "lastAlertAt">>;

/** `created` is false when the account already followed the repository. */
export type FollowResult = { ok: true; created: boolean; follow: FollowRecord } | { ok: false; reason: "limit" };

/** Aggregate page events (login funnel): counted per UTC day, no user, IP or user agent. */
/** Kinds the page may send to POST /api/event. */
export const CLIENT_EVENT_KINDS = ["login_view", "login_start", "signin_complete", "email_click"] as const;
/** All kinds, including the ones only the service counts (monitor and emails, docs/SPRINT_6.md 3.7). */
export const EVENT_KINDS = [...CLIENT_EVENT_KINDS, "rescan_complete", "rescan_incomplete", "rescan_failed", "email_follow_confirm", "email_alert", "email_paused", "email_capped", "email_failed", "unsubscribe"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface ReportStore {
  claimQuota(userId: string, limit: number, windowSeconds: number): Promise<QuotaDecision>;
  /** Most recent report for this commit not older than `maxAgeMs`, from any user (public repositories give everyone the same report). */
  findRecent(owner: string, repo: string, sha: string, maxAgeMs: number): Promise<StoredReport | null>;
  save(report: NewReport): Promise<string>;
  /** A report by id, only when `userId` owns it. */
  get(id: string, userId: string): Promise<StoredReport | null>;
  /** Deletes reports past their `expiresAt`; returns how many. */
  purgeExpired(): Promise<number>;
  /** One line of history per finished analysis (docs/SPRINT_6.md 3.1); kept SCAN_HISTORY_DAYS. */
  recordScan(scan: NewScanSummary): Promise<void>;
  /** The account's history, newest first. */
  listScans(userId: string, limit: number): Promise<ScanSummary[]>;
  /** Follows a repository; idempotent; refuses past `limit` repositories per account. */
  follow(userId: string, owner: string, repo: string, limit: number): Promise<FollowResult>;
  unfollow(userId: string, owner: string, repo: string): Promise<void>;
  listFollows(userId: string): Promise<FollowRecord[]>;
  /** Follows not paused that are queued or not rescanned since `before`: queued first, then never-scanned, then oldest. */
  dueFollows(before: string, limit: number): Promise<FollowRecord[]>;
  updateFollow(id: string, patch: FollowPatch): Promise<void>;
  /** Queues the follows (not paused) whose last rescan saw one of these ecosystems; returns how many. */
  queueFollows(ecosystems: string[], at: string): Promise<number>;
  /** A follow by id (the unsubscribe link carries only the id and its token). */
  getFollow(id: string): Promise<FollowRecord | null>;
  /** Deletes a follow by id; true when there was one. */
  deleteFollow(id: string): Promise<boolean>;
  /** Takes one email from today's (UTC) allowance; false once `limit` emails were sent today. */
  claimEmail(limit: number): Promise<boolean>;
  /** Stores a published advisory set as received (already verified by the handler). */
  saveFeed(feed: SignedFeed): Promise<void>;
  /** The most recently published advisory set, unverified: the caller checks the signature. */
  latestFeed(): Promise<SignedFeed | null>;
  /** Adds one to today's counter for this kind. */
  countEvent(kind: EventKind): Promise<void>;
}

/** Queued follows first, earliest queued first; unqueued ones after (the "nulls last" of the Supabase query). */
function byQueue(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

export interface StoreClock {
  now?: () => Date;
}

export function createMemoryStore(clock: StoreClock = {}): ReportStore & { eventCounts(): Record<string, number> } {
  const now = clock.now ?? (() => new Date());
  const reports = new Map<string, StoredReport>();
  const scans: ScanSummary[] = [];
  const follows: FollowRecord[] = [];
  const feeds: SignedFeed[] = [];
  const emailDays = new Map<string, number>();
  const quota = new Map<string, { windowStart: number; used: number }>();
  const events = new Map<string, number>();
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
      // History outlives the reports; a line older than SCAN_HISTORY_DAYS goes too.
      for (let i = scans.length - 1; i >= 0; i--) {
        const s = scans[i];
        if (s && t - Date.parse(s.createdAt) > SCAN_HISTORY_DAYS * 86_400_000) scans.splice(i, 1);
      }
      return n;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async recordScan(scan) {
      seq += 1;
      scans.unshift({ ...scan, id: `scan-${seq.toString(36)}`, createdAt: now().toISOString() });
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async listScans(userId, limit) {
      return scans.filter((s) => s.userId === userId).slice(0, limit);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async follow(userId, owner, repo, limit) {
      const mine = follows.filter((f) => f.userId === userId);
      const existing = mine.find((f) => f.owner.toLowerCase() === owner.toLowerCase() && f.repo.toLowerCase() === repo.toLowerCase());
      if (existing) return { ok: true, created: false, follow: { ...existing } };
      if (mine.length >= limit) return { ok: false, reason: "limit" };
      seq += 1;
      const f: FollowRecord = { id: `follow-${seq.toString(36)}`, userId, owner, repo, createdAt: now().toISOString(), lastScanAt: null, lastReportId: null, lastVerdict: null, lastNewUrgent: 0, failures: 0, pausedReason: null, ecosystems: null, queuedAt: null, pendingAlert: null, lastAlertAt: null };
      follows.push(f);
      return { ok: true, created: true, follow: { ...f } };
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async unfollow(userId, owner, repo) {
      const i = follows.findIndex((f) => f.userId === userId && f.owner.toLowerCase() === owner.toLowerCase() && f.repo.toLowerCase() === repo.toLowerCase());
      if (i >= 0) follows.splice(i, 1);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async listFollows(userId) {
      // Copies, like rows from PostgREST: a caller never sees later updates through an old record.
      return follows.filter((f) => f.userId === userId).map((f) => ({ ...f }));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async dueFollows(before, limit) {
      return follows
        .filter((f) => f.pausedReason === null && (f.queuedAt !== null || f.lastScanAt === null || f.lastScanAt < before))
        .sort((a, b) => byQueue(a.queuedAt, b.queuedAt) || (a.lastScanAt ?? "").localeCompare(b.lastScanAt ?? ""))
        .slice(0, limit)
        .map((f) => ({ ...f }));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async updateFollow(id, patch) {
      const f = follows.find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async queueFollows(ecosystems, at) {
      let n = 0;
      for (const f of follows) {
        if (f.pausedReason !== null || !f.ecosystems?.some((e) => ecosystems.includes(e))) continue;
        f.queuedAt = at;
        n += 1;
      }
      return n;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async getFollow(id) {
      const f = follows.find((x) => x.id === id);
      return f ? { ...f } : null;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async deleteFollow(id) {
      const i = follows.findIndex((x) => x.id === id);
      if (i < 0) return false;
      follows.splice(i, 1);
      return true;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async claimEmail(limit) {
      const day = now().toISOString().slice(0, 10);
      const sent = emailDays.get(day) ?? 0;
      if (sent >= limit) return false;
      emailDays.set(day, sent + 1);
      return true;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async saveFeed(feed) {
      feeds.push({ ...feed });
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async latestFeed() {
      const latest = [...feeds].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
      return latest ? { ...latest } : null;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    async countEvent(kind) {
      const key = `${now().toISOString().slice(0, 10)}:${kind}`;
      events.set(key, (events.get(key) ?? 0) + 1);
    },
    /** "YYYY-MM-DD:kind" -> count, for tests and the local server. */
    eventCounts() {
      return Object.fromEntries(events);
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

const scanRowSchema = z.looseObject({
  id: z.string(),
  user_id: z.string(),
  owner: z.string(),
  repo: z.string(),
  sha: z.string(),
  verdict: z.enum(["pass", "fail", "incomplete"]),
  p1: z.number().int(),
  p2: z.number().int(),
  p3: z.number().int(),
  p4: z.number().int(),
  report_id: z.string().nullable(),
  created_at: z.string(),
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
  // Legacy service_role keys are JWTs and go in both headers; the newer sb_secret_* keys are not JWTs and go in `apikey` only.
  const legacyJwt = options.serviceKey.startsWith("ey");
  const headers = { apikey: options.serviceKey, ...(legacyJwt ? { authorization: `Bearer ${options.serviceKey}` } : {}), "content-type": "application/json" };

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
      const oldest = new Date(now().getTime() - SCAN_HISTORY_DAYS * 86_400_000).toISOString();
      await call(`/rest/v1/scans?${new URLSearchParams({ created_at: `lt.${oldest}` }).toString()}`, { method: "DELETE" });
      return parsed.success ? parsed.data.length : 0;
    },
    async recordScan(scan) {
      const row = { user_id: scan.userId, owner: scan.owner, repo: scan.repo, sha: scan.sha, verdict: scan.verdict, p1: scan.byPriority.P1, p2: scan.byPriority.P2, p3: scan.byPriority.P3, p4: scan.byPriority.P4, report_id: scan.reportId };
      await call("/rest/v1/scans", { method: "POST", body: JSON.stringify(row) });
    },
    async listScans(userId, limit) {
      const q = new URLSearchParams({ user_id: `eq.${userId}`, order: "created_at.desc", limit: String(limit) });
      const out = await call(`/rest/v1/scans?${q.toString()}`, { method: "GET" });
      const parsed = z.array(scanRowSchema).safeParse(out);
      if (!parsed.success) throw new StoreError("scans query returned an unexpected shape", 200);
      return parsed.data.map((r) => ({ id: r.id, userId: r.user_id, owner: r.owner, repo: r.repo, sha: r.sha, verdict: r.verdict, byPriority: { P1: r.p1, P2: r.p2, P3: r.p3, P4: r.p4 }, reportId: r.report_id, createdAt: r.created_at }));
    },
    async countEvent(kind) {
      await call("/rest/v1/rpc/count_event", { method: "POST", body: JSON.stringify({ p_kind: kind }) });
    },
    async follow(userId, owner, repo, limit) {
      // Atomic in the database: the count and the insert happen in one function, so two tabs cannot pass the limit together.
      const out = await call("/rest/v1/rpc/follow_repo", { method: "POST", body: JSON.stringify({ p_user: userId, p_owner: owner, p_repo: repo, p_limit: limit }) });
      const parsed = z.looseObject({ ok: z.boolean(), created: z.boolean().optional(), follow: followRowSchema.nullable().optional() }).safeParse(out);
      if (!parsed.success) throw new StoreError("follow_repo returned an unexpected shape", 200);
      if (!parsed.data.ok || !parsed.data.follow) return { ok: false, reason: "limit" };
      // Before 20261103000000_email.sql the function does not say; no confirmation email is sent then.
      return { ok: true, created: parsed.data.created === true, follow: toFollow(parsed.data.follow) };
    },
    async unfollow(userId, owner, repo) {
      // The handler stores owner and repo in lower case (GitHub names are case-insensitive), so an exact match is enough.
      const q = new URLSearchParams({ user_id: `eq.${userId}`, owner: `eq.${owner}`, repo: `eq.${repo}` });
      await call(`/rest/v1/follows?${q.toString()}`, { method: "DELETE" });
    },
    async listFollows(userId) {
      const q = new URLSearchParams({ user_id: `eq.${userId}`, order: "created_at.asc" });
      return parseFollows(await call(`/rest/v1/follows?${q.toString()}`, { method: "GET" }));
    },
    async dueFollows(before, limit) {
      const q = new URLSearchParams({ paused_reason: "is.null", or: `(queued_at.not.is.null,last_scan_at.is.null,last_scan_at.lt.${before})`, order: "queued_at.asc.nullslast,last_scan_at.asc.nullsfirst", limit: String(limit) });
      return parseFollows(await call(`/rest/v1/follows?${q.toString()}`, { method: "GET" }));
    },
    async updateFollow(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.lastScanAt !== undefined) row.last_scan_at = patch.lastScanAt;
      if (patch.lastReportId !== undefined) row.last_report_id = patch.lastReportId;
      if (patch.lastVerdict !== undefined) row.last_verdict = patch.lastVerdict;
      if (patch.lastNewUrgent !== undefined) row.last_new_urgent = patch.lastNewUrgent;
      if (patch.failures !== undefined) row.failures = patch.failures;
      if (patch.pausedReason !== undefined) row.paused_reason = patch.pausedReason;
      if (patch.ecosystems !== undefined) row.ecosystems = patch.ecosystems;
      if (patch.queuedAt !== undefined) row.queued_at = patch.queuedAt;
      if (patch.pendingAlert !== undefined) row.pending_alert = patch.pendingAlert;
      if (patch.lastAlertAt !== undefined) row.last_alert_at = patch.lastAlertAt;
      await call(`/rest/v1/follows?${new URLSearchParams({ id: `eq.${id}` }).toString()}`, { method: "PATCH", body: JSON.stringify(row) });
    },
    async queueFollows(ecosystems, at) {
      // Ecosystem names come from the advisory schema's closed list; anything else would break the array literal and is dropped.
      const names = ecosystems.filter((e) => /^[A-Za-z.]+$/.test(e));
      if (names.length === 0) return 0;
      const q = new URLSearchParams({ paused_reason: "is.null", ecosystems: `ov.{${names.join(",")}}`, select: "id" });
      const out = await call(`/rest/v1/follows?${q.toString()}`, { method: "PATCH", body: JSON.stringify({ queued_at: at }), prefer: "return=representation" });
      return Array.isArray(out) ? out.length : 0;
    },
    async getFollow(id) {
      if (!ID.test(id)) return null;
      return parseFollows(await call(`/rest/v1/follows?${new URLSearchParams({ id: `eq.${id}` }).toString()}`, { method: "GET" }))[0] ?? null;
    },
    async deleteFollow(id) {
      if (!ID.test(id)) return false;
      const out = await call(`/rest/v1/follows?${new URLSearchParams({ id: `eq.${id}`, select: "id" }).toString()}`, { method: "DELETE", prefer: "return=representation" });
      return Array.isArray(out) && out.length > 0;
    },
    async claimEmail(limit) {
      return (await call("/rest/v1/rpc/claim_email", { method: "POST", body: JSON.stringify({ p_limit: limit }) })) === true;
    },
    async saveFeed(feed) {
      await call("/rest/v1/feed_sets", { method: "POST", body: JSON.stringify({ published_at: feed.publishedAt, digest: feed.digest, payload: feed.payload, signature: feed.signature }) });
    },
    async latestFeed() {
      const q = new URLSearchParams({ select: "published_at,digest,payload,signature", order: "published_at.desc", limit: "1" });
      const parsed = z.array(feedRowSchema).safeParse(await call(`/rest/v1/feed_sets?${q.toString()}`, { method: "GET" }));
      if (!parsed.success) throw new StoreError("feed_sets query returned an unexpected shape", 200);
      const row = parsed.data[0];
      return row ? { publishedAt: row.published_at, digest: row.digest, payload: row.payload, signature: row.signature } : null;
    },
  };
}

const followRowSchema = z.looseObject({
  id: z.string(),
  user_id: z.string(),
  owner: z.string(),
  repo: z.string(),
  created_at: z.string(),
  last_scan_at: z.string().nullable(),
  last_report_id: z.string().nullable(),
  last_verdict: z.enum(["pass", "fail", "incomplete"]).nullable(),
  last_new_urgent: z.number().int(),
  failures: z.number().int(),
  paused_reason: z.string().nullable(),
  // Added by 20261102000000_feed.sql; optional so the follow list keeps working before that migration.
  ecosystems: z.array(z.string()).nullable().optional(),
  queued_at: z.string().nullable().optional(),
  // Added by 20261103000000_email.sql.
  pending_alert: z.object({ reportId: z.string().max(64), count: z.number().int().min(0), items: z.array(z.object({ priority: z.enum(["P1", "P2"]), id: z.string().max(60), label: z.string().max(120) })).max(10) }).nullable().optional(),
  last_alert_at: z.string().nullable().optional(),
});

const feedRowSchema = z.looseObject({ published_at: z.string(), digest: z.string(), payload: z.string(), signature: z.string() });

function toFollow(r: z.infer<typeof followRowSchema>): FollowRecord {
  return { id: r.id, userId: r.user_id, owner: r.owner, repo: r.repo, createdAt: r.created_at, lastScanAt: r.last_scan_at, lastReportId: r.last_report_id, lastVerdict: r.last_verdict, lastNewUrgent: r.last_new_urgent, failures: r.failures, pausedReason: r.paused_reason, ecosystems: r.ecosystems ?? null, queuedAt: r.queued_at ?? null, pendingAlert: r.pending_alert ?? null, lastAlertAt: r.last_alert_at ?? null };
}

function parseFollows(out: unknown): FollowRecord[] {
  const parsed = z.array(followRowSchema).safeParse(out);
  if (!parsed.success) throw new StoreError("follows query returned an unexpected shape", 200);
  return parsed.data.map(toFollow);
}

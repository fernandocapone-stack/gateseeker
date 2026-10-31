import { z } from "zod";

import { ADVISORY_SOURCE_NAME, advisorySetFromText, loadAdvisories, type AdvisorySet } from "../intel/advisories.js";
import type { Advisory } from "../intel/advisory-schema.js";
import { verifyFeed } from "../intel/feed-signature.js";
import { compareReports } from "../report/compare.js";
import type { Report } from "../types.js";
import { GATESEEKER_VERSION } from "../version.js";
import { parseGitHubRepoUrl } from "./github-url.js";
import { bearerToken, type AuthUser, type AuthVerifier } from "./auth.js";
import { resolveGitHubRepository, scanGitHubRepository, type ServiceErrorCode, type ServiceOptions, type ServiceSuccess } from "./service.js";
import { EVENT_KINDS, StoreError, type FollowRecord, type QuotaDecision, type ReportStore } from "./store.js";

/**
 * Framework-agnostic HTTP handlers for the hosted service, shared by the
 * Vercel functions and the local development server. They only know about a
 * JSON body in, an Authorization header, and a JSON body out.
 *
 * Layers, in order, each optional so the handler also works bare:
 *   1. auth   -> who is calling (401 without a valid session)
 *   2. quota  -> per-user scans per window (429 when exhausted)
 *   3. cache  -> a report for the same commit from the last 24 h is reused
 *   4. scan   -> the service
 *   5. store  -> the report is saved for the user, with an id for /r/<id>
 */

/** The report as the page receives it: the per-dependency and per-query arrays are dropped (large, not shown). */
export type PublicReport = Omit<Report, "dependencies" | "queries">;

export interface ScanResponseOk {
  ok: true;
  /** Saved report id, null when the service runs without a store. */
  id: string | null;
  /** True when a report for the same commit was reused instead of scanning again. */
  cached: boolean;
  quota: QuotaDecision | null;
  repository: ServiceSuccess["repository"];
  archive: ServiceSuccess["archive"];
  timings: ServiceSuccess["timings"];
  report: PublicReport;
}

export type HandlerErrorCode = ServiceErrorCode | "bad-request" | "unauthorized" | "rate-limited" | "store-unavailable" | "not-found";

export interface ScanResponseError {
  ok: false;
  error: { code: HandlerErrorCode; message: string; quota?: QuotaDecision };
}

export interface HttpResponse {
  status: number;
  body: ScanResponseOk | ScanResponseError | ReportResponseOk | CleanupResponse | EventResponse | ScansResponse | FollowsResponse | MonitorResponse | FeedPublishedResponse;
}

/** What is persisted per report: the scan answer minus id, quota and cache flag, which belong to the moment of the request. */
export type SavedScan = Omit<ScanResponseOk, "id" | "quota" | "cached">;

export interface ReportResponseOk {
  ok: true;
  id: string;
  createdAt: string;
  expiresAt: string;
  saved: SavedScan;
}

export interface CleanupResponse {
  ok: true;
  deleted: number;
}

export interface EventResponse {
  ok: true;
}

export interface QuotaPolicy {
  limit: number;
  windowSeconds: number;
}

export const DEFAULT_QUOTA: QuotaPolicy = { limit: 10, windowSeconds: 3600 };
export const DEFAULT_CACHE_MS = 24 * 3600 * 1000;
export const DEFAULT_RETENTION_DAYS = 30;

export interface HandlerOptions extends Omit<ServiceOptions, "url"> {
  auth?: AuthVerifier;
  store?: ReportStore;
  quota?: QuotaPolicy;
  cacheMs?: number;
  retentionDays?: number;
  now?: () => Date;
  /** Set when the deployment demands auth but none is configured: every request answers 503 until the environment is fixed. */
  closed?: boolean;
  /** HMAC key of published advisory sets (GATESEEKER_FEED_KEY); without it only the bundled set is used. */
  feedKey?: string;
}

const bodySchema = z.object({ url: z.string().max(400) });
const eventSchema = z.object({ kind: z.enum(EVENT_KINDS) });

const STATUS: Record<HandlerErrorCode, number> = {
  "bad-request": 400,
  unauthorized: 401,
  "invalid-url": 400,
  "not-found": 404,
  private: 403,
  "ref-not-found": 404,
  "too-large": 413,
  unsupported: 422,
  "archive-rejected": 422,
  "scan-failed": 422,
  "rate-limited": 429,
  "download-failed": 502,
  "upstream-error": 502,
  "store-unavailable": 503,
  timeout: 504,
};

function fail(code: HandlerErrorCode, message: string, quota?: QuotaDecision): HttpResponse {
  return { status: STATUS[code], body: { ok: false, error: { code, message, ...(quota ? { quota } : {}) } } };
}

export function toPublicReport(report: Report): PublicReport {
  const copy: Partial<Report> = { ...report };
  delete copy.dependencies;
  delete copy.queries;
  return copy as PublicReport;
}

async function authenticate(options: HandlerOptions, authorization: string | null | undefined): Promise<AuthUser | HttpResponse> {
  if (options.closed) return fail("store-unavailable", "Sign-in is not configured on this server, so analyses are disabled.");
  if (!options.auth) return { id: "anonymous", login: null };
  const token = bearerToken(authorization);
  if (token === null) return fail("unauthorized", "Sign in to analyze a repository.");
  const user = await options.auth.verify(token);
  return user ?? fail("unauthorized", "Your session is invalid or has expired. Sign in again.");
}

function isResponse(x: AuthUser | HttpResponse): x is HttpResponse {
  return "status" in x;
}

function storeFailure(e: unknown): HttpResponse {
  const msg = e instanceof StoreError ? e.message : "unexpected store error";
  return fail("store-unavailable", `The report store is unavailable (${msg}). Try again in a minute.`);
}

export async function handleScanRequest(body: unknown, options: HandlerOptions, authorization?: string | null): Promise<HttpResponse> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("bad-request", 'Send a JSON body with a "url" string.');

  const who = await authenticate(options, authorization);
  if (isResponse(who)) return who;
  options = await withFeed(options);

  const store = options.store;
  const now = options.now ?? (() => new Date());
  const expiresAt = (): string => new Date(now().getTime() + (options.retentionDays ?? DEFAULT_RETENTION_DAYS) * 86_400_000).toISOString();
  const url = parsed.data.url;

  if (!store) {
    const result = await scanGitHubRepository({ ...options, url });
    if (!result.ok) return { status: STATUS[result.error.code], body: { ok: false, error: result.error } };
    const { repository, archive, timings, report } = result.value;
    return { status: 200, body: { ok: true, id: null, cached: false, quota: null, repository, archive, timings, report: toPublicReport(report) } };
  }

  // Resolve the commit first (two cheap API calls, no download): a recent report for the same commit is reused without spending quota.
  const resolved = await resolveGitHubRepository({ ...options, url });
  if (!resolved.ok) return { status: STATUS[resolved.error.code], body: { ok: false, error: resolved.error } };
  const repository = resolved.value;
  try {
    const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
    const hit = cacheMs > 0 ? await store.findRecent(repository.owner, repository.repo, repository.sha, cacheMs) : null;
    if (hit && (await reusable(hit.body as SavedScan, options))) {
      const id = await store.save({ userId: who.id, owner: repository.owner, repo: repository.repo, ref: repository.ref, sha: repository.sha, cachedFrom: hit.id, body: hit.body, expiresAt: expiresAt() });
      const saved = hit.body as SavedScan;
      await recordHistory(store, who.id, saved, id);
      return { status: 200, body: { ...saved, id, cached: true, quota: null } };
    }
  } catch (e) {
    return storeFailure(e);
  }

  let quota: QuotaDecision;
  const policy = options.quota ?? DEFAULT_QUOTA;
  try {
    quota = await store.claimQuota(who.id, policy.limit, policy.windowSeconds);
  } catch (e) {
    return storeFailure(e);
  }
  if (!quota.allowed) return fail("rate-limited", `You have used ${String(quota.used)} of ${String(quota.limit)} analyses in this window. It resets at ${quota.resetAt}.`, quota);

  const result = await scanGitHubRepository({ ...options, url, resolved: repository });
  if (!result.ok) return { status: STATUS[result.error.code], body: { ok: false, error: result.error } };
  const { archive, timings, report } = result.value;
  const fresh: SavedScan = { ok: true, repository: result.value.repository, archive, timings, report: toPublicReport(report) };
  try {
    const id = await store.save({ userId: who.id, owner: repository.owner, repo: repository.repo, ref: repository.ref, sha: repository.sha, cachedFrom: null, body: fresh, expiresAt: expiresAt() });
    await recordHistory(store, who.id, fresh, id);
    return { status: 200, body: { ...fresh, id, cached: false, quota } };
  } catch (e) {
    return storeFailure(e);
  }
}

/**
 * The history line of a saved analysis. History is secondary to the report the
 * person is waiting for: a failure here is swallowed (the report was saved and
 * is returned), and the Dashboard falls back to the browser's copy.
 */
/** The curated feed digest a report was produced with, from its sources line; null when dependencies were not analyzed. */
function advisoryDigestOf(report: PublicReport): string | null {
  const source = report.sources.find((x) => x.name === ADVISORY_SOURCE_NAME);
  return source ? (/digest ([0-9a-f]+)/.exec(source.endpoint)?.[1] ?? null) : null;
}

async function feedDigest(options: HandlerOptions): Promise<string | null> {
  const set = await currentAdvisories(options);
  return set.origin === "none" ? null : set.digest;
}

// --- curated feed without a redeploy (docs/SPRINT_6.md 3.5) ------------------

/** How long one function instance keeps the published set before reading the database again. */
const FEED_TTL_MS = 5 * 60_000;
/** A signed set older (or newer) than this when it arrives is refused, so an old set cannot be sent again to roll the feed back. */
const FEED_MAX_SKEW_MS = 10 * 60_000;

let bundled: Promise<AdvisorySet> | null = null;
const liveFeed = new WeakMap<ReportStore, { at: number; set: Promise<AdvisorySet> }>();

function bundledAdvisories(): Promise<AdvisorySet> {
  bundled ??= loadAdvisories();
  return bundled;
}

async function loadPublished(store: ReportStore, key: string): Promise<AdvisorySet> {
  const fallback = async (problem: string | null): Promise<AdvisorySet> => {
    const b = await bundledAdvisories();
    return problem ? { ...b, problems: [...b.problems, problem] } : b;
  };
  let feed;
  try {
    feed = await store.latestFeed();
  } catch {
    return fallback("the published set could not be read from the database; the bundled set was used.");
  }
  if (!feed) return fallback(null);
  if (!verifyFeed(key, feed)) return fallback("the latest published set failed signature verification and was ignored; the bundled set was used.");
  const set = advisorySetFromText(feed.payload, `published ${feed.publishedAt}`, "published set");
  if (set.digest !== feed.digest) return fallback("the latest published set does not match its digest and was ignored; the bundled set was used.");
  return set;
}

/**
 * The curated set a scan uses: the latest published set when its signature
 * and digest check out, otherwise the set bundled in the build. The report's
 * sources line names which one ("published <time>" or "bundled"), and a
 * rejected published set is listed among the report's errors.
 */
export function currentAdvisories(options: HandlerOptions): Promise<AdvisorySet> {
  if (options.scan?.advisories) return Promise.resolve(options.scan.advisories);
  const { store, feedKey } = options;
  if (!store || !feedKey) return bundledAdvisories();
  const t = (options.now ?? (() => new Date()))().getTime();
  const cached = liveFeed.get(store);
  if (cached && t - cached.at < FEED_TTL_MS) return cached.set;
  const set = loadPublished(store, feedKey);
  liveFeed.set(store, { at: t, set });
  return set;
}

async function withFeed<T extends HandlerOptions>(options: T): Promise<T> {
  if (options.scan?.advisories) return options;
  return { ...options, scan: { ...options.scan, advisories: await currentAdvisories(options) } };
}

/** Ecosystems with an advisory that is new or changed since the previous set; removed advisories cannot create findings. */
function changedEcosystems(previous: readonly Advisory[] | null, next: readonly Advisory[]): string[] {
  const before = new Map((previous ?? []).map((a) => [a.id, JSON.stringify(a)]));
  const out = new Set<string>();
  for (const a of next) if (previous === null || before.get(a.id) !== JSON.stringify(a)) out.add(a.ecosystem);
  return [...out].sort();
}

/**
 * A saved report of the same commit is reused only when it was produced by
 * this version of Gateseeker with the current curated feed (docs/SPRINT_6.md
 * 3.4): a newly approved advisory must reach the next scan of an unchanged
 * commit.
 */
async function reusable(body: SavedScan, options: HandlerOptions): Promise<boolean> {
  if (body.report.gateseekerVersion !== GATESEEKER_VERSION) return false;
  const used = advisoryDigestOf(body.report);
  return used === null || used === (await feedDigest(options));
}

async function recordHistory(store: ReportStore, userId: string, saved: SavedScan, reportId: string): Promise<void> {
  try {
    const { repository, report } = saved;
    await store.recordScan({ userId, owner: repository.owner, repo: repository.repo, sha: repository.sha, verdict: report.gate.verdict, byPriority: { ...report.summary.byPriority }, reportId });
  } catch {
    /* history line lost; the report itself is safe */
  }
}

export interface ScanHistoryEntry {
  owner: string;
  repo: string;
  sha: string;
  verdict: "pass" | "fail" | "incomplete";
  byPriority: { P1: number; P2: number; P3: number; P4: number };
  reportId: string | null;
  at: string;
}

export interface ScansResponse {
  ok: true;
  scans: ScanHistoryEntry[];
}

/** GET /api/scans: the signed-in account's analyses, newest first (docs/SPRINT_6.md 3.1). */
export async function handleScansRequest(options: HandlerOptions, authorization?: string | null): Promise<HttpResponse> {
  const store = options.store;
  if (!store) return fail("not-found", "History is not available on this server.");
  const who = await authenticate(options, authorization);
  if (isResponse(who)) return who;
  try {
    const rows = await store.listScans(who.id, 100);
    return { status: 200, body: { ok: true, scans: rows.map((r) => ({ owner: r.owner, repo: r.repo, sha: r.sha, verdict: r.verdict, byPriority: r.byPriority, reportId: r.reportId, at: r.createdAt })) } };
  } catch (e) {
    return storeFailure(e);
  }
}

export async function handleReportRequest(id: string, options: HandlerOptions, authorization?: string | null): Promise<HttpResponse> {
  const store = options.store;
  if (!store) return fail("not-found", "Saved reports are not available on this server.");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return fail("not-found", "No report with this id.");
  const who = await authenticate(options, authorization);
  if (isResponse(who)) return who;
  try {
    const r = await store.get(id, who.id);
    if (!r) return fail("not-found", "No report with this id, or it belongs to another account.");
    return { status: 200, body: { ok: true, id: r.id, createdAt: r.createdAt, expiresAt: r.expiresAt, saved: r.body as SavedScan } };
  } catch (e) {
    return storeFailure(e);
  }
}

/** Daily cleanup called by Vercel Cron with `Authorization: Bearer <CRON_SECRET>`. */
export async function handleCleanupRequest(options: HandlerOptions, authorization: string | null | undefined, cronSecret: string | undefined): Promise<HttpResponse> {
  if (!cronSecret || bearerToken(authorization) !== cronSecret) return fail("unauthorized", "Cron secret missing or wrong.");
  const store = options.store;
  if (!store) return { status: 200, body: { ok: true, deleted: 0 } };
  try {
    const deleted = await store.purgeExpired();
    return { status: 200, body: { ok: true, deleted } };
  } catch (e) {
    return storeFailure(e);
  }
}

/**
 * POST /api/event: one aggregate counter per kind and UTC day (the login
 * funnel). Anonymous by necessity, since visits to /login happen before
 * sign-in; it stores no user, IP or user agent, accepts only the known
 * kinds, and the database caps each daily counter. Failures are reported but
 * the page never waits on them.
 */
export async function handleEventRequest(body: unknown, options: HandlerOptions): Promise<HttpResponse> {
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return fail("bad-request", `Send a JSON body with a "kind" of ${EVENT_KINDS.join(", ")}.`);
  if (!options.store) return { status: 200, body: { ok: true } };
  try {
    await options.store.countEvent(parsed.data.kind);
    return { status: 200, body: { ok: true } };
  } catch (e) {
    return storeFailure(e);
  }
}

// --- following and the daily monitor (docs/SPRINT_6.md 3.3, 3.4) ------------

export const FOLLOW_LIMIT = 10;
const followSchema = z.object({ owner: z.string().max(100), repo: z.string().max(150) });

export interface FollowView {
  owner: string;
  repo: string;
  since: string;
  lastScanAt: string | null;
  lastReportId: string | null;
  lastVerdict: "pass" | "fail" | "incomplete" | null;
  lastNewUrgent: number;
  failures: number;
  pausedReason: string | null;
}

export interface FollowsResponse {
  ok: true;
  follows: FollowView[];
}

function followView(f: FollowRecord): FollowView {
  return { owner: f.owner, repo: f.repo, since: f.createdAt, lastScanAt: f.lastScanAt, lastReportId: f.lastReportId, lastVerdict: f.lastVerdict, lastNewUrgent: f.lastNewUrgent, failures: f.failures, pausedReason: f.pausedReason };
}

/**
 * /api/follows: GET lists the account's followed repositories; POST and
 * DELETE take {owner, repo}, checked with the same strict grammar as a scan
 * URL and stored in lower case (GitHub names are case-insensitive).
 */
export async function handleFollowsRequest(method: string, body: unknown, options: HandlerOptions & { followLimit?: number }, authorization?: string | null): Promise<HttpResponse> {
  const store = options.store;
  if (!store) return fail("not-found", "Following repositories is not available on this server.");
  const who = await authenticate(options, authorization);
  if (isResponse(who)) return who;
  try {
    if (method === "GET") return { status: 200, body: { ok: true, follows: (await store.listFollows(who.id)).map(followView) } };
    const parsed = followSchema.safeParse(body);
    if (!parsed.success) return fail("bad-request", "Send a JSON body with owner and repo.");
    const url = parseGitHubRepoUrl(`https://github.com/${parsed.data.owner}/${parsed.data.repo}`);
    if (!url.ok) return fail("invalid-url", url.reason);
    const owner = url.value.owner.toLowerCase();
    const repo = url.value.repo.toLowerCase();
    if (method === "DELETE") {
      await store.unfollow(who.id, owner, repo);
      return { status: 200, body: { ok: true, follows: (await store.listFollows(who.id)).map(followView) } };
    }
    if (method !== "POST") return fail("bad-request", "Use GET, POST or DELETE.");
    const limit = options.followLimit ?? FOLLOW_LIMIT;
    const r = await store.follow(who.id, owner, repo, limit);
    if (!r.ok) return fail("rate-limited", `You can follow up to ${String(limit)} repositories. Unfollow one first.`);
    return { status: 200, body: { ok: true, follows: (await store.listFollows(who.id)).map(followView) } };
  } catch (e) {
    return storeFailure(e);
  }
}

export interface MonitorResponse {
  ok: true;
  /** Followed repositories rescanned in this call. */
  checked: number;
  /** Due repositories left for the next call (time budget). */
  remaining: number;
  /** Rescans with new P1/P2 findings compared with the previous one. */
  withNewUrgent: number;
  failed: number;
  paused: number;
}

export interface MonitorOptions {
  /** Stop starting new rescans once less than this is left (ms); default 60 s, about one rescan. */
  reserveMs?: number;
  /** Total time for one call (ms); default 240 s, under the function limit. */
  budgetMs?: number;
  /** A follow is due when its last rescan is older than this (ms); default 20 h, so a daily cron always finds it. */
  minIntervalMs?: number;
  clock?: () => number;
}

/** Codes that mean the repository cannot be monitored any more, as opposed to a passing failure. */
const PAUSING = new Set(["not-found", "private"]);

async function monitorOne(f: FollowRecord, options: HandlerOptions, store: ReportStore, at: string): Promise<"ok" | "new-urgent" | "failed" | "paused"> {
  const url = `https://github.com/${f.owner}/${f.repo}`;
  const resolved = await resolveGitHubRepository({ ...options, url });
  if (!resolved.ok) {
    if (PAUSING.has(resolved.error.code)) {
      await store.updateFollow(f.id, { pausedReason: resolved.error.code === "private" ? "The repository is private now." : "The repository was not found on GitHub.", lastScanAt: at, queuedAt: null });
      return "paused";
    }
    await store.updateFollow(f.id, { failures: f.failures + 1, lastScanAt: at, queuedAt: null });
    return "failed";
  }
  const repository = resolved.value;
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const hit = cacheMs > 0 ? await store.findRecent(repository.owner, repository.repo, repository.sha, cacheMs) : null;
  let saved: SavedScan;
  let cachedFrom: string | null = null;
  if (hit && (await reusable(hit.body as SavedScan, options))) {
    saved = hit.body as SavedScan;
    cachedFrom = hit.id;
  } else {
    const result = await scanGitHubRepository({ ...options, url, resolved: repository });
    if (!result.ok) {
      await store.updateFollow(f.id, { failures: f.failures + 1, lastScanAt: at, queuedAt: null });
      return "failed";
    }
    saved = { ok: true, repository: result.value.repository, archive: result.value.archive, timings: result.value.timings, report: toPublicReport(result.value.report) };
  }
  const now = options.now ?? (() => new Date());
  const id = await store.save({ userId: f.userId, owner: repository.owner, repo: repository.repo, ref: repository.ref, sha: repository.sha, cachedFrom, body: saved, expiresAt: new Date(now().getTime() + (options.retentionDays ?? DEFAULT_RETENTION_DAYS) * 86_400_000).toISOString() });
  await recordHistory(store, f.userId, saved, id);

  // New P1/P2 findings against the previous rescan; the first rescan of a follow is the baseline and reports none.
  let newUrgent = 0;
  if (f.lastReportId) {
    const previous = await store.get(f.lastReportId, f.userId);
    if (previous) {
      const c = compareReports((previous.body as SavedScan).report, saved.report);
      newUrgent = c.newFindings.filter((x) => x.priority === "P1" || x.priority === "P2").length;
    }
  }
  const incomplete = saved.report.gate.verdict === "incomplete";
  const ecosystems = [...new Set(saved.report.project.lockfiles.map((l) => (l.kind === "composer.lock" ? "Packagist" : "npm")))].sort();
  await store.updateFollow(f.id, { lastScanAt: at, lastReportId: id, lastVerdict: saved.report.gate.verdict, lastNewUrgent: newUrgent, failures: incomplete ? f.failures + 1 : 0, ecosystems, queuedAt: null });
  if (incomplete) return "failed";
  return newUrgent > 0 ? "new-urgent" : "ok";
}

/**
 * GET /api/cron/monitor, called daily by Vercel Cron with the cron secret.
 * Rescans the followed repositories that are due, oldest first, until the
 * time budget runs low, and leaves the rest for the next call. Monitoring
 * does not spend the hourly analysis quota of the account. Alert emails
 * (step 5) read the follow rows this writes.
 */
export async function handleMonitorRequest(options: HandlerOptions & MonitorOptions, authorization: string | null | undefined, cronSecret: string | undefined): Promise<HttpResponse> {
  if (!cronSecret || bearerToken(authorization) !== cronSecret) return fail("unauthorized", "Cron secret missing or wrong.");
  const store = options.store;
  if (!store) return { status: 200, body: { ...EMPTY_MONITOR } };
  try {
    return { status: 200, body: await runMonitor(await withFeed(options), store) };
  } catch (e) {
    return storeFailure(e);
  }
}

const EMPTY_MONITOR: MonitorResponse = { ok: true, checked: 0, remaining: 0, withNewUrgent: 0, failed: 0, paused: 0 };

/** Rescans the due follows (queued first) until the time budget runs low. */
async function runMonitor(options: HandlerOptions & MonitorOptions, store: ReportStore): Promise<MonitorResponse> {
  const clock = options.clock ?? (() => Date.now());
  const now = options.now ?? (() => new Date());
  const deadline = clock() + (options.budgetMs ?? 240_000);
  const reserve = options.reserveMs ?? 60_000;
  const before = new Date(now().getTime() - (options.minIntervalMs ?? 20 * 3_600_000)).toISOString();
  const out = { ...EMPTY_MONITOR };
  const due = await store.dueFollows(before, 200);
  for (const f of due) {
    if (deadline - clock() < reserve) {
      out.remaining = due.length - out.checked;
      break;
    }
    const result = await monitorOne(f, options, store, now().toISOString());
    out.checked += 1;
    if (result === "new-urgent") out.withNewUrgent += 1;
    if (result === "failed") out.failed += 1;
    if (result === "paused") out.paused += 1;
  }
  return out;
}

const feedSchema = z.object({
  publishedAt: z.iso.datetime(),
  digest: z.string().regex(/^[0-9a-f]{16}$/),
  // Under the 4.5 MB request limit of Vercel functions; today's set is a few KB.
  payload: z.string().max(4_000_000),
  signature: z.string().max(128),
});

export interface FeedPublishedResponse {
  ok: true;
  digest: string;
  /** False when the set equals the latest published one (a re-run of the workflow): nothing was stored or queued. */
  changed: boolean;
  /** Ecosystems with new or changed advisories, and how many followed repositories they put in front of the queue. */
  ecosystems: string[];
  queued: number;
  /** The rescans this call ran right away, queued repositories first, within the same time budget as the cron. */
  monitor: MonitorResponse;
}

/**
 * POST /api/feed/published, called by the feed workflow after approved
 * records reach main (docs/SPRINT_6.md 3.5). The signature is the
 * authentication: only the workflow and the service know the key. The set
 * must be freshly signed and newer than the latest one, its records must all
 * validate and its digest must match. The service stores it (the database
 * key never leaves the service), queues the followed repositories of the
 * ecosystems that changed, and rescans them right away within the time budget;
 * the daily cron picks up whatever is left.
 */
export async function handleFeedPublishedRequest(body: unknown, options: HandlerOptions & MonitorOptions): Promise<HttpResponse> {
  const key = options.feedKey;
  if (!key) return fail("unauthorized", "Publishing the feed is not configured on this server.");
  const parsed = feedSchema.safeParse(body);
  if (!parsed.success) return fail("bad-request", "Send a JSON body with publishedAt, digest, payload and signature.");
  const feed = parsed.data;
  if (!verifyFeed(key, feed)) return fail("unauthorized", "Signature missing or wrong.");
  const now = options.now ?? (() => new Date());
  const publishedAt = Date.parse(feed.publishedAt);
  if (Math.abs(now().getTime() - publishedAt) > FEED_MAX_SKEW_MS) return fail("unauthorized", "The signed set is too old or dated in the future; sign it again.");
  const set = advisorySetFromText(feed.payload, `published ${feed.publishedAt}`, "published set");
  if (set.problems.length > 0) return fail("bad-request", `The set has invalid records: ${set.problems.slice(0, 3).join("; ")}`);
  if (set.digest !== feed.digest) return fail("bad-request", "The digest does not match the payload.");
  const store = options.store;
  if (!store) return fail("not-found", "Publishing the feed needs the report store.");
  try {
    const latest = await store.latestFeed();
    if (latest && Date.parse(latest.publishedAt) >= publishedAt) return fail("bad-request", "A set published at the same time or later is already stored.");
    const previous = latest && verifyFeed(key, latest) ? advisorySetFromText(latest.payload, "previous") : null;
    if (previous?.digest === set.digest) return { status: 200, body: { ok: true, digest: set.digest, changed: false, ecosystems: [], queued: 0, monitor: { ...EMPTY_MONITOR } } };
    await store.saveFeed(feed);
    liveFeed.delete(store);
    // The first published set has nothing to compare with: every ecosystem in it counts as changed.
    const ecosystems = changedEcosystems(previous?.advisories ?? null, set.advisories);
    const queued = ecosystems.length > 0 ? await store.queueFollows(ecosystems, now().toISOString()) : 0;
    const monitor = await runMonitor({ ...options, scan: { ...options.scan, advisories: set } }, store);
    return { status: 200, body: { ok: true, digest: set.digest, changed: true, ecosystems, queued, monitor } };
  } catch (e) {
    return storeFailure(e);
  }
}

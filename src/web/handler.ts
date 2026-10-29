import { z } from "zod";

import type { Report } from "../types.js";
import { bearerToken, type AuthUser, type AuthVerifier } from "./auth.js";
import { resolveGitHubRepository, scanGitHubRepository, type ServiceErrorCode, type ServiceOptions, type ServiceSuccess } from "./service.js";
import { EVENT_KINDS, StoreError, type QuotaDecision, type ReportStore } from "./store.js";

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
  body: ScanResponseOk | ScanResponseError | ReportResponseOk | CleanupResponse | EventResponse;
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
    if (hit) {
      const id = await store.save({ userId: who.id, owner: repository.owner, repo: repository.repo, ref: repository.ref, sha: repository.sha, cachedFrom: hit.id, body: hit.body, expiresAt: expiresAt() });
      const saved = hit.body as SavedScan;
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
    return { status: 200, body: { ...fresh, id, cached: false, quota } };
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

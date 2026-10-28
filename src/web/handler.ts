import { z } from "zod";

import type { Report } from "../types.js";
import { scanGitHubRepository, type ServiceErrorCode, type ServiceOptions, type ServiceSuccess } from "./service.js";

/**
 * Framework-agnostic HTTP handler for the hosted service, shared by the
 * Vercel function and the local development server. It only knows about a
 * JSON body in and a JSON body out; rate limiting and persistence are layered
 * on top by the caller.
 */

/** The report as the page receives it: the per-dependency and per-query arrays are dropped (large, not shown). */
export type PublicReport = Omit<Report, "dependencies" | "queries">;

export interface ScanResponseOk {
  ok: true;
  repository: ServiceSuccess["repository"];
  archive: ServiceSuccess["archive"];
  timings: ServiceSuccess["timings"];
  report: PublicReport;
}

export interface ScanResponseError {
  ok: false;
  error: { code: ServiceErrorCode | "bad-request"; message: string };
}

export interface HttpResponse {
  status: number;
  body: ScanResponseOk | ScanResponseError;
}

const bodySchema = z.object({ url: z.string().max(400) });

const STATUS: Record<ServiceErrorCode | "bad-request", number> = {
  "bad-request": 400,
  "invalid-url": 400,
  "not-found": 404,
  private: 403,
  "ref-not-found": 404,
  "too-large": 413,
  unsupported: 422,
  "archive-rejected": 422,
  "scan-failed": 422,
  "download-failed": 502,
  "upstream-error": 502,
  timeout: 504,
};

export function toPublicReport(report: Report): PublicReport {
  const copy: Partial<Report> = { ...report };
  delete copy.dependencies;
  delete copy.queries;
  return copy as PublicReport;
}

export async function handleScanRequest(body: unknown, options: Omit<ServiceOptions, "url">): Promise<HttpResponse> {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { ok: false, error: { code: "bad-request", message: "Send a JSON body with a \"url\" string." } } };
  const result = await scanGitHubRepository({ ...options, url: parsed.data.url });
  if (!result.ok) return { status: STATUS[result.error.code], body: { ok: false, error: result.error } };
  const { repository, archive, timings, report } = result.value;
  return { status: 200, body: { ok: true, repository, archive, timings, report: toPublicReport(report) } };
}

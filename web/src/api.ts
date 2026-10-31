import type { ReportResponseOk, ScanResponseError, ScanResponseOk, ScansResponse } from "gateseeker/dist/web/handler.js";

export type { PublicReport, ReportResponseOk, SavedScan, ScanHistoryEntry, ScanResponseError, ScanResponseOk, ScansResponse } from "gateseeker/dist/web/handler.js";
export type { Finding } from "gateseeker/dist/types.js";

export type ScanOutcome = ScanResponseOk | ScanResponseError;
export type ReportOutcome = ReportResponseOk | ScanResponseError;

async function call<T>(input: string, init: RequestInit, token: string | null): Promise<T | ScanResponseError> {
  try {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined), ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const res = await fetch(input, { ...init, headers });
    const text = await res.text();
    try {
      return JSON.parse(text) as T | ScanResponseError;
    } catch {
      return { ok: false, error: { code: "upstream-error", message: `The service answered HTTP ${String(res.status)} without a readable body.` } };
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, error: { code: "timeout", message: "The request was cancelled." } };
    return { ok: false, error: { code: "upstream-error", message: "The service could not be reached. Check your connection and try again." } };
  }
}

/** Calls the service. Network failures and non-JSON answers become a client-side error object, never an exception. */
export function scanRepository(url: string, token: string | null, signal?: AbortSignal): Promise<ScanOutcome> {
  return call<ScanResponseOk>("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }), ...(signal ? { signal } : {}) }, token);
}

/** The signed-in account's analysis history, newest first. */
export function fetchScans(token: string): Promise<ScansResponse | ScanResponseError> {
  return call<ScansResponse>("/api/scans", { method: "GET" }, token);
}

/** A saved report of the signed-in account. */
export function fetchReport(id: string, token: string): Promise<ReportOutcome> {
  return call<ReportResponseOk>(`/api/reports/${encodeURIComponent(id)}`, { method: "GET" }, token);
}

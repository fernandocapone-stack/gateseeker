import type { ScanResponseError, ScanResponseOk } from "gateseeker/dist/web/handler.js";

export type { PublicReport, ScanResponseError, ScanResponseOk } from "gateseeker/dist/web/handler.js";
export type { Finding } from "gateseeker/dist/types.js";

export type ScanOutcome = ScanResponseOk | ScanResponseError;

/** Calls the service. Network failures and non-JSON answers become a client-side error object, never an exception. */
export async function scanRepository(url: string, signal?: AbortSignal): Promise<ScanOutcome> {
  try {
    const res = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }), signal });
    const text = await res.text();
    try {
      return JSON.parse(text) as ScanOutcome;
    } catch {
      return { ok: false, error: { code: "upstream-error", message: `The service answered HTTP ${res.status} without a readable body.` } };
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, error: { code: "timeout", message: "The request was cancelled." } };
    return { ok: false, error: { code: "upstream-error", message: "The service could not be reached. Check your connection and try again." } };
  }
}

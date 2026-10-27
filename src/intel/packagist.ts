import { z } from "zod";

/**
 * Read-only client for Packagist's p2 metadata
 * (https://repo.packagist.org/p2/<vendor>/<package>.json).
 *
 * Used to learn which commit a published version currently points at, so a
 * lockfile reference can be compared with it: same version, different commit
 * is the signature of a rewritten tag. Approved by the PO for Sprint 2b: https
 * only, no token, injected fetch, timeout, memoised per run.
 */

export const PACKAGIST_SOURCE_NAME = "packagist.org";
export const PACKAGIST_P2_BASE = "https://repo.packagist.org/p2/";

const versionSchema = z.looseObject({
  version: z.string().optional(),
  version_normalized: z.string().optional(),
  source: z.looseObject({ type: z.string().optional(), url: z.string().optional(), reference: z.string().optional() }).nullable().optional(),
  time: z.string().nullable().optional(),
});

const p2Schema = z.looseObject({
  packages: z.record(z.string(), z.array(z.looseObject({}))),
  minified: z.string().optional(),
});

export interface PackagistVersion {
  version: string;
  reference: string | null;
  sourceUrl: string | null;
  time: string | null;
}

export type PackagistOutcome =
  | { status: "ok"; versions: PackagistVersion[]; queriedAt: string }
  | { status: "not-found"; queriedAt: string }
  | { status: "failed"; error: string; queriedAt: string };

export interface PackagistClientOptions {
  fetch?: typeof fetch;
  base?: string;
  timeoutMs?: number;
  now?: () => Date;
}

/**
 * Packagist's "minified" format is delta-encoded: each version object only
 * carries the keys that differ from the previous one. Expand before reading.
 */
export function expandMinified(list: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let prev: Record<string, unknown> = {};
  for (const item of list) {
    let expanded: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(item)) {
      if (v === "__unset") expanded = Object.fromEntries(Object.entries(expanded).filter(([key]) => key !== k));
      else expanded[k] = v;
    }
    out.push(expanded);
    prev = expanded;
  }
  return out;
}

export function normalizeVersionForCompare(v: string): string {
  return v.replace(/^v(?=\d)/, "");
}

export class PackagistClient {
  private readonly fetchFn: typeof fetch;
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly cache = new Map<string, Promise<PackagistOutcome>>();

  constructor(options: PackagistClientOptions = {}) {
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.base = options.base ?? PACKAGIST_P2_BASE;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.now = options.now ?? (() => new Date());
  }

  versions(name: string): Promise<PackagistOutcome> {
    let pending = this.cache.get(name);
    if (!pending) {
      pending = this.fetchVersions(name);
      this.cache.set(name, pending);
    }
    return pending;
  }

  /** The commit a published version currently points at, or null when the version is unknown. */
  async currentReference(name: string, version: string): Promise<{ status: "ok"; reference: string | null; time: string | null } | { status: "failed"; error: string } | { status: "not-found" }> {
    const r = await this.versions(name);
    if (r.status !== "ok") return r.status === "failed" ? { status: "failed", error: r.error } : { status: "not-found" };
    const wanted = normalizeVersionForCompare(version);
    const hit = r.versions.find((v) => normalizeVersionForCompare(v.version) === wanted);
    return hit ? { status: "ok", reference: hit.reference, time: hit.time } : { status: "not-found" };
  }

  private async fetchVersions(name: string): Promise<PackagistOutcome> {
    const queriedAt = this.now().toISOString();
    if (!/^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/.test(name)) {
      return { status: "failed", error: `"${name}" is not a valid Composer package name`, queriedAt };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.base}${name}.json`, { signal: controller.signal, headers: { accept: "application/json" } });
      if (res.status === 404) return { status: "not-found", queriedAt };
      if (!res.ok) return { status: "failed", error: `HTTP ${res.status}`, queriedAt };
      const json = (await res.json());
      const parsed = p2Schema.safeParse(json);
      if (!parsed.success) return { status: "failed", error: "response does not match the Packagist p2 schema", queriedAt };
      const raw = parsed.data.packages[name];
      if (!raw) return { status: "not-found", queriedAt };
      const list = (parsed.data.minified !== undefined ? expandMinified(raw) : raw).map((v) => versionSchema.safeParse(v)).filter((v) => v.success).map((v) => v.data);
      const versions: PackagistVersion[] = list
        .filter((v) => typeof v.version === "string")
        .map((v) => ({ version: v.version ?? "", reference: v.source?.reference ?? null, sourceUrl: v.source?.url ?? null, time: v.time ?? null }));
      return { status: "ok", versions, queriedAt };
    } catch (err) {
      if (controller.signal.aborted) return { status: "failed", error: `timed out after ${this.timeoutMs} ms`, queriedAt };
      return { status: "failed", error: `network error: ${err instanceof Error ? err.message : String(err)}`, queriedAt };
    } finally {
      clearTimeout(timer);
    }
  }
}

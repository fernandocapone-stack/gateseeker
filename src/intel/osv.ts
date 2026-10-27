import type { Dependency } from "../types.js";
import { osvQueryResponseSchema, type OsvVulnerability } from "./osv-schema.js";

/**
 * Isolated client for the OSV API (https://google.github.io/osv.dev/api/).
 *
 * Uses POST /v1/query per unique name@version. The batch endpoint returns only
 * vulnerability ids and would require one extra GET per id; for the project
 * sizes targeted in Sprint 0 the per-package query is simpler and yields the
 * full record in one call.
 *
 * Network access goes through an injected `fetch` so unit tests stay offline.
 */

export const OSV_SOURCE_NAME = "osv.dev";
export const OSV_QUERY_ENDPOINT = "https://api.osv.dev/v1/query";

/** Safety cap on pagination to avoid unbounded loops on a misbehaving server. */
const MAX_PAGES = 20;

export interface OsvClientOptions {
  fetch?: typeof fetch;
  endpoint?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum simultaneous in-flight requests. */
  concurrency?: number;
  now?: () => Date;
}

export type OsvQueryOutcome =
  | { status: "ok"; vulns: OsvVulnerability[]; queriedAt: string }
  | { status: "failed"; error: string; queriedAt: string };

export interface OsvQuery {
  name: string;
  version: string;
  ecosystem: "npm" | "Packagist";
}

interface ResolvedOptions {
  fetch: typeof fetch;
  endpoint: string;
  timeoutMs: number;
  concurrency: number;
  now: () => Date;
}

export class OsvClient {
  private readonly opts: ResolvedOptions;
  private readonly cache = new Map<string, Promise<OsvQueryOutcome>>();

  constructor(options: OsvClientOptions = {}) {
    this.opts = {
      fetch: options.fetch ?? globalThis.fetch,
      endpoint: options.endpoint ?? OSV_QUERY_ENDPOINT,
      timeoutMs: options.timeoutMs ?? 10_000,
      concurrency: Math.max(1, options.concurrency ?? 5),
      now: options.now ?? (() => new Date()),
    };
  }

  /** Queries one package version. Results are memoised per name@version for the client's lifetime. */
  query(q: OsvQuery): Promise<OsvQueryOutcome> {
    const key = `${q.ecosystem}:${q.name}@${q.version}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.queryUncached(q);
      this.cache.set(key, pending);
    }
    return pending;
  }

  /**
   * Queries every dependency with a registry-resolvable version, honouring the
   * concurrency limit. Dependencies without a usable version are not queried
   * and are absent from the returned map.
   */
  async queryAll(deps: Dependency[]): Promise<Map<string, OsvQueryOutcome>> {
    const queryable = deps.filter(
      (d): d is Dependency & { version: string } =>
        d.versionStatus === "ok" && d.version !== null,
    );
    const results = new Map<string, OsvQueryOutcome>();
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < queryable.length) {
        const dep = queryable[next++];
        if (!dep) break;
        const outcome = await this.query({
          name: dep.name,
          version: dep.version,
          ecosystem: dep.ecosystem,
        });
        results.set(`${dep.name}@${dep.version}`, outcome);
      }
    };

    const workers = Array.from(
      { length: Math.min(this.opts.concurrency, queryable.length) },
      () => worker(),
    );
    await Promise.all(workers);
    return results;
  }

  private async queryUncached(q: OsvQuery): Promise<OsvQueryOutcome> {
    const queriedAt = this.opts.now().toISOString();
    const vulns: OsvVulnerability[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const body: Record<string, unknown> = {
        package: { name: q.name, ecosystem: q.ecosystem },
        version: q.version,
      };
      if (pageToken !== undefined) body.page_token = pageToken;

      const result = await this.post(body);
      if (result.status === "failed") return { ...result, queriedAt };

      vulns.push(...(result.data.vulns ?? []));
      pageToken = result.data.next_page_token;
      if (pageToken === undefined) {
        return { status: "ok", vulns, queriedAt };
      }
    }

    return {
      status: "failed",
      error: `Pagination exceeded ${MAX_PAGES} pages; result would be incomplete.`,
      queriedAt,
    };
  }

  private async post(
    body: Record<string, unknown>,
  ): Promise<
    | { status: "ok"; data: ReturnType<typeof osvQueryResponseSchema.parse> }
    | { status: "failed"; error: string }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.opts.timeoutMs);

    let response: Response;
    try {
      response = await this.opts.fetch(this.opts.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        return { status: "failed", error: `Request timed out after ${this.opts.timeoutMs} ms.` };
      }
      return {
        status: "failed",
        error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    clearTimeout(timer);

    if (!response.ok) {
      return { status: "failed", error: `HTTP ${response.status} ${response.statusText}`.trim() };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      return {
        status: "failed",
        error: `Response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const parsed = osvQueryResponseSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        status: "failed",
        error: `Response does not match the OSV schema: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown issue"}`,
      };
    }
    return { status: "ok", data: parsed.data };
  }
}

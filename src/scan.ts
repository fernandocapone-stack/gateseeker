import { createHash, randomUUID } from "node:crypto";
import { OSV_QUERY_ENDPOINT, OSV_SOURCE_NAME, OsvClient, type OsvClientOptions } from "./intel/osv.js";
import { DEFAULT_PARSER_LIMITS, parseLockfile, type ParseError, type ParserLimits } from "./parser/lockfile.js";
import { buildFinding } from "./rules/findings.js";
import { PRIORITIES, priorityAtLeast } from "./rules/priority.js";
import type { Finding, Priority, QueryRecord, QueryState, Report, Verdict } from "./types.js";
import { GATESEEKER_VERSION } from "./version.js";

/**
 * Orchestrates one scan: parse -> query -> rules -> report.
 * Pure with respect to I/O: the caller reads the file and passes its content.
 */

export interface ScanOptions {
  lockfilePath: string;
  lockfileContent: string;
  failOn?: Priority;
  limits?: Partial<ParserLimits>;
  osv?: OsvClientOptions;
  now?: () => Date;
  runId?: string;
}

export type ScanResult =
  | { ok: true; report: Report }
  | { ok: false; error: ParseError };

const KNOWN_LIMITATIONS = [
  "Only package-lock.json lockfileVersion 2 and 3 are supported.",
  "Only the npm ecosystem is queried; workspace packages and symlinked (file:) packages are not queried.",
  "Dependencies with missing, non-semver or non-registry (git, tarball) versions are not queried.",
  "OSV is the only intelligence source. A package whose published artifact was tampered with without a new version (supply-chain compromise) is not detected.",
  "Severity is computed from CVSS 3.x vectors; CVSS 2 and 4 vectors are preserved but not scored.",
  "Priority does not consider whether vulnerable code is actually reachable from the project.",
  "'No known vulnerabilities' means none was returned by the sources consulted at query time, not that the dependency is secure.",
];

export async function scan(options: ScanOptions): Promise<ScanResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const failOn = options.failOn ?? "P2";
  const limits: ParserLimits = { ...DEFAULT_PARSER_LIMITS, ...options.limits };

  const parsed = parseLockfile(options.lockfileContent, limits);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const lockfile = parsed.lockfile;

  const client = new OsvClient({ now, ...options.osv });
  const outcomes = await client.queryAll(lockfile.dependencies);

  const queries: QueryRecord[] = [];
  const findings: Finding[] = [];
  const errors: string[] = [...lockfile.warnings];

  for (const dep of lockfile.dependencies) {
    const key = `${dep.name}@${dep.version ?? "<missing>"}`;
    const outcome = outcomes.get(key);

    if (outcome === undefined) {
      queries.push({
        dependency: key,
        state: "not-queried",
        source: OSV_SOURCE_NAME,
        queriedAt: null,
        error: `Version status is "${dep.versionStatus}"; registry lookup not applicable.`,
      });
      continue;
    }

    if (outcome.status === "failed") {
      queries.push({
        dependency: key,
        state: "query-failed",
        source: OSV_SOURCE_NAME,
        queriedAt: outcome.queriedAt,
        error: outcome.error,
      });
      errors.push(`Query for ${key} failed: ${outcome.error}`);
      continue;
    }

    const source = { name: OSV_SOURCE_NAME, queriedAt: outcome.queriedAt };
    for (const vuln of outcome.vulns) {
      findings.push(buildFinding(dep, vuln, source));
    }
    queries.push({
      dependency: key,
      state: outcome.vulns.length > 0 ? "vulnerable" : "no-known-vulnerabilities",
      source: OSV_SOURCE_NAME,
      queriedAt: outcome.queriedAt,
      error: null,
    });
  }

  findings.sort((a, b) =>
    a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority.localeCompare(b.priority),
  );

  const byQueryState: Record<QueryState, number> = {
    vulnerable: 0,
    "no-known-vulnerabilities": 0,
    "query-failed": 0,
    "not-queried": 0,
  };
  for (const q of queries) byQueryState[q.state]++;

  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
  for (const f of findings) byPriority[f.priority]++;

  const gate = decideVerdict(findings, byQueryState, failOn);

  const report: Report = {
    gateseekerVersion: GATESEEKER_VERSION,
    runId: options.runId ?? randomUUID(),
    startedAt,
    finishedAt: now().toISOString(),
    project: {
      lockfilePath: options.lockfilePath,
      lockfileSha256: createHash("sha256").update(options.lockfileContent).digest("hex"),
      lockfileVersion: lockfile.lockfileVersion,
      name: lockfile.projectName,
    },
    dependencies: lockfile.dependencies,
    queries,
    findings,
    summary: {
      dependencies: lockfile.dependencies.length,
      queried: byQueryState.vulnerable + byQueryState["no-known-vulnerabilities"] + byQueryState["query-failed"],
      byQueryState,
      byPriority,
    },
    sources: [{ name: OSV_SOURCE_NAME, endpoint: options.osv?.endpoint ?? OSV_QUERY_ENDPOINT }],
    gate: { failOn, ...gate },
    errors,
    limitations: KNOWN_LIMITATIONS,
  };

  return { ok: true, report };
}

/**
 * Gate rule, in order:
 *   1. any finding at or above the threshold -> fail (even if other queries failed);
 *   2. otherwise any failed or skipped query -> incomplete (never pass);
 *   3. otherwise pass.
 */
export function decideVerdict(
  findings: Finding[],
  byQueryState: Record<QueryState, number>,
  failOn: Priority,
): { verdict: Verdict; reason: string } {
  const blocking = findings.filter((f) => priorityAtLeast(f.priority, failOn)).length;
  if (blocking > 0) {
    return {
      verdict: "fail",
      reason: `${blocking} finding(s) at priority ${failOn} or higher.`,
    };
  }
  const unresolved = byQueryState["query-failed"] + byQueryState["not-queried"];
  if (unresolved > 0) {
    return {
      verdict: "incomplete",
      reason: `${byQueryState["query-failed"]} query(ies) failed and ${byQueryState["not-queried"]} dependency(ies) could not be queried; absence of findings cannot be asserted.`,
    };
  }
  return {
    verdict: "pass",
    reason: `All ${byQueryState.vulnerable + byQueryState["no-known-vulnerabilities"]} dependencies were queried; no finding at priority ${failOn} or higher. No known vulnerabilities at that level were found in the sources consulted.`,
  };
}

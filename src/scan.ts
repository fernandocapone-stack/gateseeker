import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { OSV_QUERY_ENDPOINT, OSV_SOURCE_NAME, OsvClient, type OsvClientOptions } from "./intel/osv.js";
import { DEFAULT_PARSER_LIMITS, parseLockfile, type ParseErrorCode, type ParserLimits } from "./parser/lockfile.js";
import { PATTERN_SOURCE_NAME, runRules } from "./patterns/engine.js";
import { RULES } from "./patterns/rules/index.js";
import { DEFAULT_WALK_LIMITS, walkProject, type WalkErrorCode, type WalkLimits } from "./patterns/walker.js";
import type { Rule } from "./patterns/types.js";
import { buildFinding } from "./rules/findings.js";
import { PRIORITIES, priorityAtLeast } from "./rules/priority.js";
import type { Finding, FindingKind, PatternsMode, PatternsReport, Priority, QueryRecord, QueryState, Report, Verdict } from "./types.js";
import { GATESEEKER_VERSION } from "./version.js";

/**
 * Orchestrates one scan: (lockfile → OSV → rules) and/or (directory → rules),
 * then assembles a Report with a gate verdict.
 */

export type Analysis = "deps" | "patterns";

export interface ScanCommonOptions {
  failOn?: Priority;
  patternsMode?: PatternsMode;
  limits?: Partial<ParserLimits>;
  walkLimits?: Partial<WalkLimits>;
  osv?: OsvClientOptions;
  rules?: Rule[];
  now?: () => Date;
  runId?: string;
}

/** Lockfile-only scan; the caller has already read the file. */
export interface ScanLockfileOptions extends ScanCommonOptions {
  lockfilePath: string;
  lockfileContent: string;
}

/** Directory scan: patterns always, dependencies when a package-lock.json exists at the root. */
export interface ScanDirectoryOptions extends ScanCommonOptions {
  root: string;
  only?: Analysis;
}

export interface ScanError {
  code: ParseErrorCode | WalkErrorCode;
  message: string;
}

export type ScanResult = { ok: true; report: Report } | { ok: false; error: ScanError };

const DEPENDENCY_LIMITATIONS = [
  "Only package-lock.json lockfileVersion 2 and 3 are supported.",
  "Only the npm ecosystem is queried; workspace packages and symlinked (file:) packages are not queried.",
  "Dependencies with missing, non-semver or non-registry (git, tarball) versions are not queried.",
  "OSV is the only intelligence source. A package whose published artifact was tampered with without a new version (supply-chain compromise) is not detected.",
  "Severity is computed from CVSS 3.x vectors; CVSS 2 and 4 vectors are preserved but not scored.",
  "Priority does not consider whether vulnerable code is actually reachable from the project.",
];

const PATTERN_LIMITATIONS = [
  "Pattern rules are lexical and structural checks on text files; they do not follow data flow and cannot find injection or missing authorization in general.",
  "File classification (client/server/config/...) is heuristic and recorded on each finding; a misclassified file can hide or produce a finding.",
  "node_modules, build outputs, binaries and paths matched by the root .gitignore are not scanned.",
  "Gateseeker never runs git; whether a file is actually committed must be verified by the user.",
];

const COMMON_LIMITATIONS = [
  "'No known vulnerabilities' means none was returned by the sources consulted at query time, not that the project is secure.",
];

interface DepsOutcome {
  lockfilePath: string;
  sha256: string;
  lockfileVersion: number;
  name: string | null;
  dependencies: Report["dependencies"];
  queries: QueryRecord[];
  findings: Finding[];
  errors: string[];
  endpoint: string;
}

async function analyzeDependencies(lockfilePath: string, content: string, opts: ScanCommonOptions, now: () => Date): Promise<{ ok: true; deps: DepsOutcome } | { ok: false; error: ScanError }> {
  const limits: ParserLimits = { ...DEFAULT_PARSER_LIMITS, ...opts.limits };
  const parsed = parseLockfile(content, limits);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const lockfile = parsed.lockfile;

  const client = new OsvClient({ now, ...opts.osv });
  const outcomes = await client.queryAll(lockfile.dependencies);

  const queries: QueryRecord[] = [];
  const findings: Finding[] = [];
  const errors: string[] = [...lockfile.warnings];

  for (const dep of lockfile.dependencies) {
    const key = `${dep.name}@${dep.version ?? "<missing>"}`;
    const outcome = outcomes.get(key);
    if (outcome === undefined) {
      queries.push({ dependency: key, state: "not-queried", source: OSV_SOURCE_NAME, queriedAt: null, error: `Version status is "${dep.versionStatus}"; registry lookup not applicable.` });
      continue;
    }
    if (outcome.status === "failed") {
      queries.push({ dependency: key, state: "query-failed", source: OSV_SOURCE_NAME, queriedAt: outcome.queriedAt, error: outcome.error });
      errors.push(`Query for ${key} failed: ${outcome.error}`);
      continue;
    }
    const source = { name: OSV_SOURCE_NAME, queriedAt: outcome.queriedAt };
    for (const vuln of outcome.vulns) findings.push(buildFinding(dep, vuln, source));
    queries.push({ dependency: key, state: outcome.vulns.length > 0 ? "vulnerable" : "no-known-vulnerabilities", source: OSV_SOURCE_NAME, queriedAt: outcome.queriedAt, error: null });
  }

  return {
    ok: true,
    deps: {
      lockfilePath,
      sha256: createHash("sha256").update(content).digest("hex"),
      lockfileVersion: lockfile.lockfileVersion,
      name: lockfile.projectName,
      dependencies: lockfile.dependencies,
      queries,
      findings,
      errors,
      endpoint: opts.osv?.endpoint ?? OSV_QUERY_ENDPOINT,
    },
  };
}

interface PatternsOutcome {
  findings: Finding[];
  summary: PatternsReport;
}

async function analyzePatterns(root: string, opts: ScanCommonOptions, now: () => Date): Promise<{ ok: true; patterns: PatternsOutcome } | { ok: false; error: ScanError }> {
  const walked = await walkProject(root, { ...DEFAULT_WALK_LIMITS, ...opts.walkLimits });
  if (!walked.ok) return { ok: false, error: walked.error };
  const run = runRules(walked.project, opts.rules ?? RULES, now);
  return { ok: true, patterns: { findings: run.findings, summary: run.summary } };
}

export async function scan(options: ScanLockfileOptions): Promise<ScanResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const deps = await analyzeDependencies(options.lockfilePath, options.lockfileContent, options, now);
  if (!deps.ok) return deps;
  return { ok: true, report: assemble({ root: dirname(resolve(options.lockfilePath)), startedAt, deps: deps.deps, patterns: null, options, now }) };
}

export async function scanDirectory(options: ScanDirectoryOptions): Promise<ScanResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const root = resolve(options.root);
  const only = options.only;

  let deps: DepsOutcome | null = null;
  if (only !== "patterns") {
    const lockfilePath = join(root, "package-lock.json");
    let content: string | null;
    try {
      content = await readFile(lockfilePath, "utf8");
    } catch {
      content = null;
    }
    if (content !== null) {
      const result = await analyzeDependencies(lockfilePath, content, options, now);
      if (!result.ok) return result;
      deps = result.deps;
    }
  }

  let patterns: PatternsOutcome | null = null;
  if (only !== "deps") {
    const result = await analyzePatterns(root, options, now);
    if (!result.ok) return result;
    patterns = result.patterns;
  }

  return { ok: true, report: assemble({ root, startedAt, deps, patterns, options, now }) };
}

function assemble(args: { root: string; startedAt: string; deps: DepsOutcome | null; patterns: PatternsOutcome | null; options: ScanCommonOptions; now: () => Date }): Report {
  const { root, startedAt, deps, patterns, options, now } = args;
  const failOn = options.failOn ?? "P2";
  const patternsMode = options.patternsMode ?? "warn";

  const findings = [...(deps?.findings ?? []), ...(patterns?.findings ?? [])];
  findings.sort((a, b) => (a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority.localeCompare(b.priority)));

  const byQueryState: Record<QueryState, number> = { vulnerable: 0, "no-known-vulnerabilities": 0, "query-failed": 0, "not-queried": 0 };
  for (const q of deps?.queries ?? []) byQueryState[q.state]++;

  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
  for (const f of findings) byPriority[f.priority]++;

  const byKind: Record<FindingKind, number> = { "dependency-vulnerability": 0, "insecure-pattern": 0, "supply-chain-anomaly": 0, "secret-exposure": 0 };
  for (const f of findings) byKind[f.kind]++;

  const gateFindings = findings.filter((f) => f.kind !== "insecure-pattern" || patternsMode === "gate");
  const gate = decideVerdict(gateFindings, byQueryState, failOn, { deps: deps !== null, patterns: patterns !== null, patternsMode });

  const errors = [...(deps?.errors ?? [])];
  if (patterns) {
    for (const inv of patterns.summary.invalidSuppressions) errors.push(`Suppression without a reason ignored at ${inv.file}:${inv.line}.`);
  }

  const limitations = [...COMMON_LIMITATIONS];
  if (deps) limitations.push(...DEPENDENCY_LIMITATIONS);
  else limitations.push("Dependencies were not analyzed: no package-lock.json at the project root (or --only patterns).");
  if (patterns) limitations.push(...PATTERN_LIMITATIONS);
  else limitations.push("Code patterns were not analyzed (lockfile-only scan or --only deps).");

  const sources: Report["sources"] = [];
  if (deps) sources.push({ name: OSV_SOURCE_NAME, endpoint: deps.endpoint });
  if (patterns) sources.push({ name: PATTERN_SOURCE_NAME, endpoint: `builtin rules v${GATESEEKER_VERSION}` });

  return {
    gateseekerVersion: GATESEEKER_VERSION,
    runId: options.runId ?? randomUUID(),
    startedAt,
    finishedAt: now().toISOString(),
    project: {
      rootPath: root,
      lockfilePath: deps?.lockfilePath ?? null,
      lockfileSha256: deps?.sha256 ?? null,
      lockfileVersion: deps?.lockfileVersion ?? null,
      name: deps?.name ?? null,
    },
    analyses: { dependencies: deps ? "analyzed" : "not-analyzed", patterns: patterns ? "analyzed" : "not-analyzed" },
    patterns: patterns?.summary ?? null,
    dependencies: deps?.dependencies ?? [],
    queries: deps?.queries ?? [],
    findings,
    summary: {
      dependencies: deps?.dependencies.length ?? 0,
      queried: byQueryState.vulnerable + byQueryState["no-known-vulnerabilities"] + byQueryState["query-failed"],
      byQueryState,
      byPriority,
      byKind,
    },
    sources,
    gate: { failOn, patternsMode, ...gate },
    errors,
    limitations,
  };
}

/**
 * Gate rule, in order:
 *   1. any gate-relevant finding at or above the threshold -> fail;
 *   2. otherwise any failed or skipped dependency query -> incomplete (never pass);
 *   3. otherwise pass, stating which analyses ran.
 */
export function decideVerdict(
  findings: Finding[],
  byQueryState: Record<QueryState, number>,
  failOn: Priority,
  ran: { deps: boolean; patterns: boolean; patternsMode: PatternsMode } = { deps: true, patterns: false, patternsMode: "warn" },
): { verdict: Verdict; reason: string } {
  const blocking = findings.filter((f) => priorityAtLeast(f.priority, failOn)).length;
  if (blocking > 0) {
    return { verdict: "fail", reason: `${blocking} finding(s) at priority ${failOn} or higher.` };
  }
  const unresolved = byQueryState["query-failed"] + byQueryState["not-queried"];
  if (unresolved > 0) {
    return {
      verdict: "incomplete",
      reason: `${byQueryState["query-failed"]} query(ies) failed and ${byQueryState["not-queried"]} dependency(ies) could not be queried; absence of findings cannot be asserted.`,
    };
  }
  const parts: string[] = [];
  if (ran.deps) parts.push(`all ${byQueryState.vulnerable + byQueryState["no-known-vulnerabilities"]} dependencies were queried`);
  if (ran.patterns) parts.push(ran.patternsMode === "gate" ? "code patterns were analyzed and gated" : "code patterns were analyzed in warn mode (not gated)");
  const ranText = parts.length > 0 ? parts.join("; ") : "no analysis ran";
  return {
    verdict: "pass",
    reason: `${ranText.charAt(0).toUpperCase()}${ranText.slice(1)}; no finding at priority ${failOn} or higher. No known vulnerabilities at that level were found in the sources consulted.`,
  };
}

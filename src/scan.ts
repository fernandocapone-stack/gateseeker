import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { ADVISORY_SOURCE_NAME, advisoryMatches, advisoryTagMatch, buildAdvisoryFinding, loadAdvisories, type AdvisorySet } from "./intel/advisories.js";
import { OSV_QUERY_ENDPOINT, OSV_SOURCE_NAME, OsvClient, type OsvClientOptions } from "./intel/osv.js";
import { PACKAGIST_P2_BASE, PACKAGIST_SOURCE_NAME, PackagistClient, type PackagistClientOptions } from "./intel/packagist.js";
import { parseComposerLock } from "./parser/composer.js";
import { DEFAULT_PARSER_LIMITS, parseLockfile, type ParseErrorCode, type ParserLimits } from "./parser/lockfile.js";
import { PATTERN_SOURCE_NAME, runRules } from "./patterns/engine.js";
import { RULES } from "./patterns/rules/index.js";
import type { Rule } from "./patterns/types.js";
import { DEFAULT_WALK_LIMITS, walkProject, type WalkErrorCode, type WalkLimits } from "./patterns/walker.js";
import { buildFinding } from "./rules/findings.js";
import { PRIORITIES, priorityAtLeast } from "./rules/priority.js";
import { snapshotFromComposer, snapshotFromNpm, type LockSnapshot } from "./supplychain/snapshot.js";
import { SUPPLY_CHAIN_SOURCE_NAME, diffBaseline, runSupplyChainRules, type BaselineDiff } from "./supplychain/rules.js";
import type { Dependency, Finding, FindingKind, PatternsMode, PatternsReport, Priority, QueryRecord, QueryState, Report, Verdict } from "./types.js";
import { GATESEEKER_VERSION } from "./version.js";

/**
 * Orchestrates one scan: lockfiles (npm and/or Composer) → OSV + curated
 * advisories + structural rules, directory → code-pattern rules, then a Report
 * with a gate verdict.
 */

export type Analysis = "deps" | "patterns";
export type LockfileKind = "package-lock.json" | "composer.lock";

export interface ScanCommonOptions {
  failOn?: Priority;
  patternsMode?: PatternsMode;
  /** Structural supply-chain rules (GSK-SC-*) default to warn like code patterns. */
  supplyChainMode?: PatternsMode;
  limits?: Partial<ParserLimits>;
  walkLimits?: Partial<WalkLimits>;
  osv?: OsvClientOptions;
  /** Packagist lookups for tag-rewrite verification; `false` disables them (findings become unverified). */
  packagist?: PackagistClientOptions | false;
  advisoriesPath?: string;
  advisories?: AdvisorySet;
  rules?: Rule[];
  /** A previous lockfile of the same kind to compare against. */
  baseline?: { path: string; content: string };
  maxReleaseAgeDays?: number;
  now?: () => Date;
  runId?: string;
}

export interface ScanLockfileOptions extends ScanCommonOptions {
  lockfilePath: string;
  lockfileContent: string;
  /** composer.json content, when scanning a composer.lock. */
  manifestContent?: string | null;
}

export interface ScanDirectoryOptions extends ScanCommonOptions {
  root: string;
  only?: Analysis;
}

export interface ScanError {
  code: ParseErrorCode | WalkErrorCode | "baseline-mismatch" | "unknown-lockfile";
  message: string;
}

export type ScanResult = { ok: true; report: Report } | { ok: false; error: ScanError };

const DEPENDENCY_LIMITATIONS = [
  "Only package-lock.json lockfileVersion 2 and 3 and Composer 2 composer.lock files are supported.",
  "Workspace packages, symlinked (file:/path) packages and dev-* branches are not queried against vulnerability sources.",
  "Dependencies with missing, non-semver or non-registry versions are not queried.",
  "Dependency intelligence comes from OSV plus the curated Gateseeker advisory set listed in sources; an incident absent from both is not detected.",
  "Severity is computed from CVSS 3.x vectors; CVSS 2 and 4 vectors are preserved but not scored.",
  "Priority does not consider whether vulnerable code is actually reachable from the project.",
  "Structural supply-chain rules compare lockfiles only; without --baseline just the single-lockfile rules run.",
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

export function lockfileKind(path: string, content?: string): LockfileKind | null {
  const name = basename(path).toLowerCase();
  if (name.endsWith("package-lock.json")) return "package-lock.json";
  if (name.endsWith("composer.lock")) return "composer.lock";
  if (content !== undefined) {
    // Unknown file name: a cheap textual probe decides; the parser validates afterwards.
    if (/"lockfileVersion"\s*:/.test(content)) return "package-lock.json";
    if (/"packages"\s*:\s*\[/.test(content) && /"(content-hash|plugin-api-version|packages-dev)"/.test(content)) return "composer.lock";
  }
  return null;
}

interface LockOutcome {
  kind: LockfileKind;
  lockfilePath: string;
  sha256: string;
  lockfileVersion: number | null;
  name: string | null;
  dependencies: Dependency[];
  queries: QueryRecord[];
  findings: Finding[];
  errors: string[];
  endpoint: string;
  advisories: AdvisorySet;
  snapshot: LockSnapshot;
}

async function analyzeLockfile(
  kind: LockfileKind,
  lockfilePath: string,
  content: string,
  manifest: string | null,
  opts: ScanCommonOptions,
  now: () => Date,
  advisories: AdvisorySet,
): Promise<{ ok: true; lock: LockOutcome } | { ok: false; error: ScanError }> {
  const limits: ParserLimits = { ...DEFAULT_PARSER_LIMITS, ...opts.limits };
  let dependencies: Dependency[];
  let warnings: string[];
  let name: string | null;
  let lockfileVersion: number | null;
  let snapshot: LockSnapshot;

  if (kind === "package-lock.json") {
    const parsed = parseLockfile(content, limits);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    dependencies = parsed.lockfile.dependencies;
    warnings = parsed.lockfile.warnings;
    name = parsed.lockfile.projectName;
    lockfileVersion = parsed.lockfile.lockfileVersion;
    snapshot = snapshotFromNpm(parsed.lockfile, lockfilePath, content);
  } else {
    const parsed = parseComposerLock(content, manifest, limits);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    dependencies = parsed.lockfile.dependencies;
    warnings = parsed.lockfile.warnings;
    name = parsed.lockfile.projectName;
    lockfileVersion = null;
    snapshot = snapshotFromComposer(parsed.lockfile, lockfilePath, content);
  }

  const client = new OsvClient({ now, ...opts.osv });
  const outcomes = await client.queryAll(dependencies);
  const stamp = now().toISOString();

  const queries: QueryRecord[] = [];
  const findings: Finding[] = [];
  const errors: string[] = [...warnings];

  for (const dep of dependencies) {
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

  // Curated advisories: version/range matches for every dependency with a usable version,
  // plus tag-rewrite matches for Composer verified against Packagist when needed.
  const packagist = opts.packagist === false ? null : new PackagistClient({ now, ...(opts.packagist ?? {}) });
  const approved = advisories.advisories.filter((a) => a.status === "approved");
  for (const dep of dependencies) {
    const key = `${dep.name}@${dep.version ?? "<missing>"}`;
    const hits: Finding[] = [];
    let tagLookupError: string | null = null;
    let tagChecked = false;
    for (const a of approved) {
      if (dep.versionStatus === "ok" && advisoryMatches(a, dep)) {
        hits.push(buildAdvisoryFinding(dep, a, stamp));
        continue;
      }
      const tag = await advisoryTagMatch(a, dep, packagist);
      if (tag.verification === "not-applicable") continue;
      tagChecked = true;
      if (tag.lookupError) tagLookupError = tag.lookupError;
      if (tag.matched) hits.push(buildAdvisoryFinding(dep, a, stamp, tag));
    }
    findings.push(...hits);
    if (dep.versionStatus === "ok" || tagChecked) {
      queries.push({ dependency: key, state: hits.length > 0 ? "vulnerable" : "no-known-vulnerabilities", source: ADVISORY_SOURCE_NAME, queriedAt: stamp, error: null });
    }
    if (tagChecked) {
      if (tagLookupError && packagist === null) {
        queries.push({ dependency: key, state: "not-queried", source: PACKAGIST_SOURCE_NAME, queriedAt: null, error: tagLookupError });
      } else if (tagLookupError) {
        queries.push({ dependency: key, state: "query-failed", source: PACKAGIST_SOURCE_NAME, queriedAt: stamp, error: tagLookupError });
        errors.push(`Packagist lookup for ${key} failed: ${tagLookupError}`);
      } else {
        queries.push({ dependency: key, state: hits.some((h) => h.evidence.kind === "supply-chain-anomaly" && h.evidence.verification === "verified") ? "vulnerable" : "no-known-vulnerabilities", source: PACKAGIST_SOURCE_NAME, queriedAt: stamp, error: null });
      }
    }
  }

  return {
    ok: true,
    lock: {
      kind,
      lockfilePath,
      sha256: createHash("sha256").update(content).digest("hex"),
      lockfileVersion,
      name,
      dependencies,
      queries,
      findings,
      errors,
      endpoint: opts.osv?.endpoint ?? OSV_QUERY_ENDPOINT,
      advisories,
      snapshot,
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

async function resolveAdvisories(opts: ScanCommonOptions): Promise<AdvisorySet> {
  return opts.advisories ?? (await loadAdvisories(opts.advisoriesPath !== undefined ? { path: opts.advisoriesPath } : {}));
}

function baselineSnapshot(kind: LockfileKind, baseline: { path: string; content: string }, opts: ScanCommonOptions): { ok: true; snapshot: LockSnapshot } | { ok: false; error: ScanError } {
  const bkind = lockfileKind(baseline.path);
  if (bkind !== kind) {
    return { ok: false, error: { code: "baseline-mismatch", message: `--baseline must be a ${kind} like the scanned lockfile; got ${basename(baseline.path)}.` } };
  }
  const limits: ParserLimits = { ...DEFAULT_PARSER_LIMITS, ...opts.limits };
  if (kind === "package-lock.json") {
    const p = parseLockfile(baseline.content, limits);
    if (!p.ok) return { ok: false, error: { code: p.error.code, message: `baseline: ${p.error.message}` } };
    return { ok: true, snapshot: snapshotFromNpm(p.lockfile, baseline.path, baseline.content) };
  }
  const p = parseComposerLock(baseline.content, null, limits);
  if (!p.ok) return { ok: false, error: { code: p.error.code, message: `baseline: ${p.error.message}` } };
  return { ok: true, snapshot: snapshotFromComposer(p.lockfile, baseline.path, baseline.content) };
}

export async function scan(options: ScanLockfileOptions): Promise<ScanResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const kind = lockfileKind(options.lockfilePath, options.lockfileContent);
  if (kind === null) return { ok: false, error: { code: "unknown-lockfile", message: `${basename(options.lockfilePath)} is not a supported lockfile (package-lock.json or composer.lock).` } };
  const advisories = await resolveAdvisories(options);
  const lock = await analyzeLockfile(kind, options.lockfilePath, options.lockfileContent, options.manifestContent ?? null, options, now, advisories);
  if (!lock.ok) return lock;
  return finishScan({ root: dirname(resolve(options.lockfilePath)), startedAt, locks: [lock.lock], patterns: null, options, now });
}

export async function scanDirectory(options: ScanDirectoryOptions): Promise<ScanResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const root = resolve(options.root);
  const only = options.only;

  const locks: LockOutcome[] = [];
  if (only !== "patterns") {
    const advisories = await resolveAdvisories(options);
    for (const kind of ["package-lock.json", "composer.lock"] as LockfileKind[]) {
      const lockfilePath = join(root, kind);
      let content: string | null;
      try {
        content = await readFile(lockfilePath, "utf8");
      } catch {
        content = null;
      }
      if (content === null) continue;
      let manifest: string | null = null;
      if (kind === "composer.lock") {
        try {
          manifest = await readFile(join(root, "composer.json"), "utf8");
        } catch {
          manifest = null;
        }
      }
      const result = await analyzeLockfile(kind, lockfilePath, content, manifest, options, now, advisories);
      if (!result.ok) return result;
      locks.push(result.lock);
    }
  }

  let patterns: PatternsOutcome | null = null;
  if (only !== "deps") {
    const result = await analyzePatterns(root, options, now);
    if (!result.ok) return result;
    patterns = result.patterns;
  }

  return finishScan({ root, startedAt, locks, patterns, options, now });
}

function finishScan(args: { root: string; startedAt: string; locks: LockOutcome[]; patterns: PatternsOutcome | null; options: ScanCommonOptions; now: () => Date }): ScanResult {
  const { root, startedAt, locks, patterns, options, now } = args;
  const failOn = options.failOn ?? "P2";
  const patternsMode = options.patternsMode ?? "warn";
  const supplyChainMode = options.supplyChainMode ?? "warn";

  // Structural rules and baseline comparison.
  const structural: Finding[] = [];
  let baselineReport: Report["baseline"] = null;
  const errors: string[] = [];
  for (const lock of locks) {
    let baseline: LockSnapshot | null = null;
    if (options.baseline) {
      const bkind = lockfileKind(options.baseline.path);
      if (bkind === lock.kind) {
        const b = baselineSnapshot(lock.kind, options.baseline, options);
        if (!b.ok) return b;
        baseline = b.snapshot;
        const diff: BaselineDiff = diffBaseline(lock.snapshot, baseline);
        baselineReport = { path: options.baseline.path, sha256: baseline.sha256, ecosystem: baseline.ecosystem, ...diff };
      }
    }
    structural.push(...runSupplyChainRules(lock.snapshot, baseline, { now, maxReleaseAgeDays: options.maxReleaseAgeDays ?? 3 }));
  }
  if (options.baseline && locks.length > 0 && baselineReport === null) {
    return { ok: false, error: { code: "baseline-mismatch", message: `--baseline ${basename(options.baseline.path)} does not match any scanned lockfile (${locks.map((l) => l.kind).join(", ")}).` } };
  }

  const findings = [...locks.flatMap((l) => l.findings), ...structural, ...(patterns?.findings ?? [])];
  findings.sort((a, b) => (a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority.localeCompare(b.priority)));

  const queries = locks.flatMap((l) => l.queries);
  // The verdict counts registry query states (OSV, Packagist); advisory matching is local.
  const byQueryState: Record<QueryState, number> = { vulnerable: 0, "no-known-vulnerabilities": 0, "query-failed": 0, "not-queried": 0 };
  for (const q of queries) if (q.source !== ADVISORY_SOURCE_NAME) byQueryState[q.state]++;

  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, 0])) as Record<Priority, number>;
  for (const f of findings) byPriority[f.priority]++;
  const byKind: Record<FindingKind, number> = { "dependency-vulnerability": 0, "insecure-pattern": 0, "supply-chain-anomaly": 0, "secret-exposure": 0 };
  for (const f of findings) byKind[f.kind]++;

  const gateFindings = findings.filter((f) => {
    if (f.kind === "insecure-pattern") return patternsMode === "gate";
    if (f.kind === "supply-chain-anomaly" && f.evidence.kind === "supply-chain-anomaly" && f.evidence.origin === "structural") return supplyChainMode === "gate";
    return true;
  });
  const deps = locks.length > 0;
  const gate = decideVerdict(gateFindings, byQueryState, failOn, { deps, patterns: patterns !== null, patternsMode });

  for (const lock of locks) errors.push(...lock.errors);
  const advisorySet = locks[0]?.advisories;
  if (advisorySet && advisorySet.origin !== "none") errors.push(...advisorySet.problems.map((p) => `Advisory set: ${p}`));
  if (patterns) for (const inv of patterns.summary.invalidSuppressions) errors.push(`Suppression without a reason ignored at ${inv.file}:${inv.line}.`);

  const limitations = [...COMMON_LIMITATIONS];
  if (deps) {
    limitations.push(...DEPENDENCY_LIMITATIONS);
    if (advisorySet?.origin === "none") limitations.push("No curated advisory set was available (not built and no advisories/approved directory); only OSV was consulted for dependencies.");
    if (options.packagist === false) limitations.push("Packagist lookups were disabled; tag-rewrite matches are reported as unverified.");
    if (!options.baseline) limitations.push("No --baseline given: lockfile comparison rules (GSK-SC-002, 003, 005) did not run.");
  } else {
    limitations.push("Dependencies were not analyzed: no package-lock.json or composer.lock at the project root (or --only patterns).");
  }
  if (patterns) limitations.push(...PATTERN_LIMITATIONS);
  else limitations.push("Code patterns were not analyzed (lockfile-only scan or --only deps).");

  const sources: Report["sources"] = [];
  if (deps) {
    sources.push({ name: OSV_SOURCE_NAME, endpoint: locks[0]?.endpoint ?? OSV_QUERY_ENDPOINT });
    if (advisorySet) {
      const approvedCount = advisorySet.advisories.filter((a) => a.status === "approved").length;
      sources.push({ name: ADVISORY_SOURCE_NAME, endpoint: `${advisorySet.origin} (${approvedCount} approved, digest ${advisorySet.digest})` });
    }
    if (locks.some((l) => l.kind === "composer.lock") && options.packagist !== false) sources.push({ name: PACKAGIST_SOURCE_NAME, endpoint: options.packagist?.base ?? PACKAGIST_P2_BASE });
    sources.push({ name: SUPPLY_CHAIN_SOURCE_NAME, endpoint: `builtin rules v${GATESEEKER_VERSION}${options.baseline ? ", with baseline" : ""}` });
  }
  if (patterns) sources.push({ name: PATTERN_SOURCE_NAME, endpoint: `builtin rules v${GATESEEKER_VERSION}` });

  const first = locks[0];
  const report: Report = {
    gateseekerVersion: GATESEEKER_VERSION,
    runId: options.runId ?? randomUUID(),
    startedAt,
    finishedAt: now().toISOString(),
    project: {
      rootPath: root,
      lockfilePath: first?.lockfilePath ?? null,
      lockfileSha256: first?.sha256 ?? null,
      lockfileVersion: first?.lockfileVersion ?? null,
      name: locks.find((l) => l.name !== null)?.name ?? null,
      lockfiles: locks.map((l) => ({ path: l.lockfilePath, kind: l.kind, sha256: l.sha256, lockfileVersion: l.lockfileVersion })),
    },
    analyses: { dependencies: deps ? "analyzed" : "not-analyzed", patterns: patterns ? "analyzed" : "not-analyzed" },
    patterns: patterns?.summary ?? null,
    baseline: baselineReport,
    dependencies: locks.flatMap((l) => l.dependencies),
    queries,
    findings,
    summary: {
      dependencies: locks.reduce((n, l) => n + l.dependencies.length, 0),
      queried: byQueryState.vulnerable + byQueryState["no-known-vulnerabilities"] + byQueryState["query-failed"],
      byQueryState,
      byPriority,
      byKind,
    },
    sources,
    gate: { failOn, patternsMode, supplyChainMode, ...gate },
    errors,
    limitations,
  };
  return { ok: true, report };
}

/**
 * Gate rule, in order:
 *   1. any gated finding at or above the threshold -> fail;
 *   2. otherwise any failed or skipped registry query -> incomplete (never pass);
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
    return { verdict: "fail", reason: `${blocking} gated finding(s) at priority ${failOn} or higher.` };
  }
  const unresolved = byQueryState["query-failed"] + byQueryState["not-queried"];
  if (unresolved > 0) {
    return {
      verdict: "incomplete",
      reason: `${byQueryState["query-failed"]} query(ies) failed and ${byQueryState["not-queried"]} dependency(ies) could not be queried; absence of findings cannot be asserted.`,
    };
  }
  const parts: string[] = [];
  if (ran.deps) parts.push(`all ${byQueryState.vulnerable + byQueryState["no-known-vulnerabilities"]} dependency queries completed`);
  if (ran.patterns) parts.push(ran.patternsMode === "gate" ? "code patterns were analyzed and gated" : "code patterns were analyzed in warn mode (not gated)");
  const ranText = parts.length > 0 ? parts.join("; ") : "no analysis ran";
  return {
    verdict: "pass",
    reason: `${ranText.charAt(0).toUpperCase()}${ranText.slice(1)}; no finding at priority ${failOn} or higher. No known vulnerabilities at that level were found in the sources consulted.`,
  };
}

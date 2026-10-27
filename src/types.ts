/**
 * Domain model shared by every Gateseeker module.
 *
 * Three layers are kept apart on purpose and must never be merged:
 *   1. data reported by an intelligence source (evidence, severity, references);
 *   2. conclusions produced by deterministic rules (priority, rationale, verdict);
 *   3. explanations produced by AI (reserved field, not implemented, never decisive).
 */

export type Ecosystem = "npm";

/** How trustworthy the version string of a lockfile entry is. */
export type VersionStatus =
  | "ok" // strict semver, resolvable in the registry
  | "missing" // no version field
  | "non-semver" // version present but not strict semver
  | "non-registry"; // git, file, link or tarball source; registry lookups do not apply

export interface Exposure {
  /** Declared in the root package's dependency maps and installed at top level. */
  direct: boolean;
  /** Reachable from a non-dev dependency path (not dev-only). */
  production: boolean;
}

/** One unique name@version across the whole lockfile. */
export interface Dependency {
  name: string;
  version: string | null;
  ecosystem: Ecosystem;
  versionStatus: VersionStatus;
  exposure: Exposure;
  /** Lockfile paths where this name@version appears. */
  paths: string[];
}

export type QueryState =
  | "vulnerable"
  | "no-known-vulnerabilities"
  | "query-failed"
  | "not-queried";

export interface QueryRecord {
  dependency: string; // name@version
  state: QueryState;
  source: string; // e.g. "osv.dev"
  queriedAt: string | null; // ISO timestamp, null when not queried
  error: string | null; // present when state is "query-failed" or "not-queried"
}

export type SeverityTier = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";

export interface CvssEntry {
  type: string; // "CVSS_V3", "CVSS_V4", ... preserved as given by the source
  vector: string;
  /** Base score computed locally. Only CVSS 3.x is scored in this version. */
  score: number | null;
}

export interface Severity {
  /** Tier derived by Gateseeker from the data below. */
  tier: SeverityTier;
  /** Qualitative severity declared by the source (e.g. GitHub Advisory "HIGH"). */
  declared: string | null;
  cvss: CvssEntry[];
}

export type FindingKind =
  | "dependency-vulnerability"
  | "insecure-pattern"
  | "supply-chain-anomaly"
  | "secret-exposure";

export type Priority = "P1" | "P2" | "P3" | "P4";

export interface Reference {
  type: string;
  url: string;
}

/** Raw facts from an intelligence source about a dependency, untouched. */
export interface DependencyEvidence {
  kind: "dependency-vulnerability";
  vulnerabilityId: string;
  aliases: string[];
  summary: string | null;
  details: string | null;
  published: string | null;
  modified: string | null;
  affectedRanges: unknown; // preserved verbatim for auditing
}

/** Facts about a code pattern match. `snippet` is sanitized and redacted. */
export interface PatternEvidence {
  kind: "insecure-pattern";
  ruleId: string;
  title: string;
  file: string;
  line: number;
  fileClass: string;
  snippet: string;
  message: string;
  details: Record<string, string | number | boolean | null> | null;
}

export type Evidence = DependencyEvidence | PatternEvidence;

export interface Finding {
  id: string;
  kind: FindingKind;
  subject: string;
  evidence: Evidence;
  source: { name: string; queriedAt: string };
  severity: Severity;
  priority: Priority;
  /** Identifiers of the rules that produced `priority`, in application order. */
  rationale: string[];
  remediation: {
    fixedVersions: string[];
    action: string;
  };
  references: Reference[];
  /** Reserved for a future, optional AI explanation. Always null in this version. */
  aiExplanation: null;
}

export type Verdict = "pass" | "fail" | "incomplete";

export type PatternsMode = "warn" | "gate";

export interface PatternsReport {
  filesScanned: number;
  filesSkippedIgnored: number;
  filesSkippedBinary: number;
  bytesScanned: number;
  rulesRun: string[];
  suppressions: { file: string; line: number; ruleId: string; reason: string }[];
  invalidSuppressions: { file: string; line: number; text: string }[];
}

export interface Report {
  gateseekerVersion: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  project: {
    /** Directory scanned, or the lockfile's directory when only a lockfile was given. */
    rootPath: string;
    /** null when no package-lock.json was analyzed. */
    lockfilePath: string | null;
    lockfileSha256: string | null;
    lockfileVersion: number | null;
    name: string | null;
  };
  /** Which analyses ran. Absent analyses are declared, not silently skipped. */
  analyses: {
    dependencies: "analyzed" | "not-analyzed";
    patterns: "analyzed" | "not-analyzed";
  };
  /** null when the pattern analysis did not run. */
  patterns: PatternsReport | null;
  dependencies: Dependency[];
  queries: QueryRecord[];
  findings: Finding[];
  summary: {
    dependencies: number;
    queried: number;
    byQueryState: Record<QueryState, number>;
    byPriority: Record<Priority, number>;
    byKind: Record<FindingKind, number>;
  };
  sources: { name: string; endpoint: string }[];
  gate: {
    failOn: Priority;
    /** "warn": pattern findings are reported but do not affect the verdict. */
    patternsMode: PatternsMode;
    verdict: Verdict;
    reason: string;
  };
  errors: string[];
  limitations: string[];
}

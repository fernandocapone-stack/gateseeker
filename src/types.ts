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

export interface Finding {
  id: string;
  kind: FindingKind;
  subject: string;
  /** Raw facts from the source, untouched. */
  evidence: {
    vulnerabilityId: string;
    aliases: string[];
    summary: string | null;
    details: string | null;
    published: string | null;
    modified: string | null;
    affectedRanges: unknown; // preserved verbatim for auditing
  };
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

export interface Report {
  gateseekerVersion: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  project: {
    lockfilePath: string;
    lockfileSha256: string;
    lockfileVersion: number;
    name: string | null;
  };
  dependencies: Dependency[];
  queries: QueryRecord[];
  findings: Finding[];
  summary: {
    dependencies: number;
    queried: number;
    byQueryState: Record<QueryState, number>;
    byPriority: Record<Priority, number>;
  };
  sources: { name: string; endpoint: string }[];
  gate: {
    failOn: Priority;
    verdict: Verdict;
    reason: string;
  };
  errors: string[];
  limitations: string[];
}

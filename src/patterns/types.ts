import type { SeverityTier } from "../types.js";

/**
 * Insecure-pattern analysis: a project is a set of text files with a class;
 * rules look at files (and, for cross-file rules, at the whole snapshot) and
 * return matches. Nothing here executes project code.
 */

export type FileClass =
  | "client" // code that ends up in a browser bundle
  | "server" // API routes, middleware, edge/serverless functions, scripts
  | "config" // build and framework configuration
  | "sql" // database migrations and seeds
  | "env" // dotenv files
  | "rules" // Firebase security rules
  | "agent" // AI coding-agent configuration and instruction files (.claude/, .mcp.json, CLAUDE.md, AGENTS.md …)
  | "test" // tests, fixtures, mocks
  | "other";

export type ProjectKind = "next" | "vite" | "unknown";

export interface ProjectFile {
  /** POSIX-style path relative to the project root. */
  path: string;
  size: number;
  fileClass: FileClass;
  content: string;
  lines: string[];
}

export interface ProjectSnapshot {
  root: string;
  kind: ProjectKind;
  files: ProjectFile[];
  byPath: Map<string, ProjectFile>;
  /** Whether a root `.gitignore` covers the given relative path. */
  isGitignored: (relPath: string) => boolean;
  stats: WalkStats;
}

export interface WalkStats {
  filesScanned: number;
  filesSkippedIgnored: number;
  filesSkippedBinary: number;
  /** Files above maxFileBytes, not read; the first 10 paths. */
  filesSkippedLarge: number;
  largeFiles: string[];
  bytesScanned: number;
  directoriesVisited: number;
}

export interface RuleMatch {
  /** 1-based line number. */
  line: number;
  /** Already sanitized and redacted; safe to print. */
  snippet: string;
  message: string;
  /** Overrides the rule's intrinsic severity for this match. */
  severity?: SeverityTier;
  /** Overrides the rule's default remediation for this match. */
  action?: string;
  /** Extra structured facts for the report (never raw secrets). */
  details?: Record<string, string | number | boolean | null>;
}

export interface RuleContext {
  file: ProjectFile;
  project: ProjectSnapshot;
}

export interface Rule {
  id: string;
  title: string;
  severity: SeverityTier;
  description: string;
  /** Default remediation, overridable per match. */
  action: string;
  appliesTo: (file: ProjectFile, project: ProjectSnapshot) => boolean;
  check: (ctx: RuleContext) => RuleMatch[];
}

export interface Suppression {
  file: string;
  line: number;
  ruleId: string;
  reason: string;
}

export interface PatternsSummary {
  filesScanned: number;
  filesSkippedIgnored: number;
  filesSkippedBinary: number;
  filesSkippedLarge: number;
  largeFiles: string[];
  bytesScanned: number;
  rulesRun: string[];
  suppressions: Suppression[];
  /** Suppression comments without a reason are ignored and listed here. */
  invalidSuppressions: { file: string; line: number; text: string }[];
}

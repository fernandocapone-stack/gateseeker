import { z } from "zod";
import type { Dependency, Ecosystem, Exposure, VersionStatus } from "../types.js";

/**
 * package-lock.json parser.
 *
 * Supported: lockfileVersion 2 and 3 (npm >= 7). Both carry the `packages`
 * map, which is the only section read. The legacy `dependencies` block of
 * v2 files is ignored. lockfileVersion 1 and unknown versions are rejected.
 *
 * Never executes anything from the analyzed project. Input is text only.
 */

export const SUPPORTED_LOCKFILE_VERSIONS = [2, 3] as const;

export interface ParserLimits {
  /** Maximum lockfile size in bytes (UTF-8). */
  maxBytes: number;
  /** Maximum number of entries in `packages`, excluding the root entry. */
  maxDependencies: number;
}

export const DEFAULT_PARSER_LIMITS: ParserLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxDependencies: 5000,
};

export type ParseErrorCode =
  | "too-large"
  | "malformed-json"
  | "malformed-yaml"
  | "malformed-lockfile"
  | "invalid-schema"
  | "unsupported-lockfile-version"
  | "too-many-dependencies";

export interface ParseError {
  code: ParseErrorCode;
  message: string;
}

export interface LockfileEntry {
  /** Key inside `packages`, e.g. "node_modules/a/node_modules/b". */
  path: string;
  name: string;
  version: string | null;
  versionStatus: VersionStatus;
  direct: boolean;
  dev: boolean;
  optional: boolean;
  peer: boolean;
  resolved: string | null;
  integrity: string | null;
  hasInstallScript: boolean;
}

export interface ParsedLockfile {
  lockfileVersion: 2 | 3;
  projectName: string | null;
  entries: LockfileEntry[];
  /** Unique name@version with merged exposure, ready for querying. */
  dependencies: Dependency[];
  warnings: string[];
}

export type ParseResult =
  | { ok: true; lockfile: ParsedLockfile }
  | { ok: false; error: ParseError };

const dependencyMap = z.record(z.string(), z.string()).optional();

const packageEntrySchema = z.looseObject({
  version: z.string().optional(),
  resolved: z.string().optional(),
  link: z.boolean().optional(),
  dev: z.boolean().optional(),
  optional: z.boolean().optional(),
  devOptional: z.boolean().optional(),
  peer: z.boolean().optional(),
  inBundle: z.boolean().optional(),
  hasInstallScript: z.boolean().optional(),
  integrity: z.string().optional(),
  name: z.string().optional(),
  dependencies: dependencyMap,
  devDependencies: dependencyMap,
  optionalDependencies: dependencyMap,
  peerDependencies: dependencyMap,
});

const lockfileSchema = z.looseObject({
  name: z.string().optional(),
  lockfileVersion: z.number().int(),
  packages: z.record(z.string(), packageEntrySchema),
});

// Strict semver (https://semver.org), no leading "v", no ranges.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isStrictSemver(version: string): boolean {
  return SEMVER_RE.test(version);
}

/**
 * Compares two strict semver strings (precedence rules of semver.org §11).
 * Returns a negative number, zero or a positive number. Non-semver input
 * falls back to a plain string comparison so sorting never throws.
 */
export function compareSemver(a: string, b: string): number {
  const ma = SEMVER_RE.exec(a);
  const mb = SEMVER_RE.exec(b);
  if (!ma || !mb) return a.localeCompare(b);
  for (let i = 1; i <= 3; i++) {
    const diff = Number(ma[i]) - Number(mb[i]);
    if (diff !== 0) return diff;
  }
  const pa = ma[4];
  const pb = mb[4];
  if (pa === undefined && pb === undefined) return 0;
  if (pa === undefined) return 1; // release > pre-release
  if (pb === undefined) return -1;
  const ia = pa.split(".");
  const ib = pb.split(".");
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    const x = ia[i];
    const y = ib[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (nx) return -1;
    else if (ny) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const NODE_MODULES_SEGMENT = "node_modules/";

/** Derives the package name from a `packages` key. Returns null for workspace paths. */
export function packageNameFromPath(path: string): string | null {
  const idx = path.lastIndexOf(NODE_MODULES_SEGMENT);
  if (idx === -1) return null;
  const name = path.slice(idx + NODE_MODULES_SEGMENT.length);
  return name.length > 0 ? name : null;
}

function isTopLevel(path: string): boolean {
  return (
    path.startsWith(NODE_MODULES_SEGMENT) &&
    !path.includes(NODE_MODULES_SEGMENT, NODE_MODULES_SEGMENT.length)
  );
}

export function isNonRegistrySource(resolved: string | undefined): boolean {
  if (resolved === undefined) return false;
  if (resolved.startsWith("https://registry.")) return false;
  return /^(git\+|git:|github:|file:|link:|http:\/\/|https:\/\/.*\.(tgz|tar\.gz)$)/.test(resolved);
}

export function parseLockfile(
  content: string,
  limits: ParserLimits = DEFAULT_PARSER_LIMITS,
): ParseResult {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > limits.maxBytes) {
    return {
      ok: false,
      error: {
        code: "too-large",
        message: `Lockfile is ${bytes} bytes; limit is ${limits.maxBytes} bytes.`,
      },
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "malformed-json",
        message: `Lockfile is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  // Check the version before the full schema so v1 files get a precise message
  // instead of "packages is required".
  const versionProbe = z.looseObject({ lockfileVersion: z.unknown() }).safeParse(json);
  if (versionProbe.success) {
    const v = versionProbe.data.lockfileVersion;
    if (typeof v !== "number" || !(SUPPORTED_LOCKFILE_VERSIONS as readonly number[]).includes(v)) {
      return {
        ok: false,
        error: {
          code: "unsupported-lockfile-version",
          message: `lockfileVersion ${String(v)} is not supported. Supported: ${SUPPORTED_LOCKFILE_VERSIONS.join(", ")}.`,
        },
      };
    }
  }

  const parsed = lockfileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: {
        code: "invalid-schema",
        message: `Lockfile does not match the expected structure: ${issue ? `${issue.path.join(".") || "<root>"}: ${issue.message}` : "unknown issue"}`,
      },
    };
  }

  const data = parsed.data;
  const lockfileVersion = data.lockfileVersion as 2 | 3;
  const root = data.packages[""];
  const packageKeys = Object.keys(data.packages).filter((k) => k !== "");

  if (packageKeys.length > limits.maxDependencies) {
    return {
      ok: false,
      error: {
        code: "too-many-dependencies",
        message: `Lockfile lists ${packageKeys.length} packages; limit is ${limits.maxDependencies}.`,
      },
    };
  }

  const warnings: string[] = [];
  if (root === undefined) {
    warnings.push(
      'Root entry (packages[""]) is missing; no dependency can be classified as direct.',
    );
  }

  const declaredDirect = new Set<string>([
    ...Object.keys(root?.dependencies ?? {}),
    ...Object.keys(root?.devDependencies ?? {}),
    ...Object.keys(root?.optionalDependencies ?? {}),
    ...Object.keys(root?.peerDependencies ?? {}),
  ]);

  const entries: LockfileEntry[] = [];
  for (const path of packageKeys) {
    const pkg = data.packages[path];
    if (pkg === undefined) continue;

    const nameFromPath = packageNameFromPath(path);
    if (nameFromPath === null) {
      warnings.push(`Skipped "${path}": not under node_modules (workspace package); not queried.`);
      continue;
    }
    // `name` is only present when the installed package differs from its
    // folder (npm aliases); the registry package is the one in `name`.
    const name = pkg.name ?? nameFromPath;
    if (pkg.link === true) {
      warnings.push(`Skipped "${path}": symlink to a local package; not queried.`);
      continue;
    }

    let versionStatus: VersionStatus;
    const version = pkg.version ?? null;
    if (version === null) {
      versionStatus = "missing";
    } else if (isNonRegistrySource(pkg.resolved)) {
      versionStatus = "non-registry";
    } else if (!isStrictSemver(version)) {
      versionStatus = "non-semver";
    } else {
      versionStatus = "ok";
    }

    const dev = pkg.dev === true || pkg.devOptional === true;
    entries.push({
      path,
      name,
      version,
      versionStatus,
      direct: isTopLevel(path) && declaredDirect.has(name),
      dev,
      optional: pkg.optional === true || pkg.devOptional === true,
      peer: pkg.peer === true,
      resolved: pkg.resolved ?? null,
      integrity: pkg.integrity ?? null,
      hasInstallScript: pkg.hasInstallScript === true,
    });
  }

  return {
    ok: true,
    lockfile: {
      lockfileVersion,
      projectName: data.name ?? root?.name ?? null,
      entries,
      dependencies: aggregate(entries, "npm"),
      warnings,
    },
  };
}

/** Collapses entries into unique name@version with merged exposure. */
export function aggregate(entries: LockfileEntry[], ecosystem: Ecosystem): Dependency[] {
  const byKey = new Map<string, Dependency>();
  for (const e of entries) {
    const key = `${e.name}@${e.version ?? "<missing>"}`;
    const exposure: Exposure = { direct: e.direct, production: !e.dev };
    const existing = byKey.get(key);
    if (existing) {
      existing.exposure.direct ||= exposure.direct;
      existing.exposure.production ||= exposure.production;
      existing.paths.push(e.path);
    } else {
      byKey.set(key, {
        name: e.name,
        version: e.version,
        ecosystem,
        versionStatus: e.versionStatus,
        exposure,
        paths: [e.path],
      });
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.name === b.name
      ? (a.version ?? "").localeCompare(b.version ?? "")
      : a.name.localeCompare(b.name),
  );
}

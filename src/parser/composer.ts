import { z } from "zod";
import type { Dependency, VersionStatus } from "../types.js";
import { DEFAULT_PARSER_LIMITS, isStrictSemver, type ParseError, type ParserLimits } from "./lockfile.js";

/**
 * composer.lock parser (Composer 2 format).
 *
 * Reads `packages` and `packages-dev`. The optional composer.json next to the
 * lock tells which packages are direct (`require` / `require-dev`). Nothing is
 * executed: the files are text.
 */

const stringMap = z.record(z.string(), z.string()).optional();

const composerPackageSchema = z.looseObject({
  name: z.string().min(1),
  version: z.string().min(1),
  type: z.string().optional(),
  time: z.string().optional(),
  source: z
    .looseObject({ type: z.string().optional(), url: z.string().optional(), reference: z.string().optional() })
    .optional(),
  dist: z
    .looseObject({ type: z.string().optional(), url: z.string().optional(), reference: z.string().optional() })
    .optional(),
  autoload: z.looseObject({ files: z.array(z.string()).optional() }).optional(),
  scripts: z.record(z.string(), z.unknown()).optional(),
  require: stringMap,
});

const composerLockSchema = z.looseObject({
  packages: z.array(composerPackageSchema),
  "packages-dev": z.array(composerPackageSchema).optional(),
  "content-hash": z.string().optional(),
  "plugin-api-version": z.string().optional(),
});

const composerJsonSchema = z.looseObject({
  name: z.string().optional(),
  require: stringMap,
  "require-dev": stringMap,
});

export type ComposerPackage = z.infer<typeof composerPackageSchema>;

export interface ComposerEntry {
  name: string;
  /** Version as written in the lock (e.g. "v12.3.0", "dev-main"). */
  rawVersion: string;
  /** Normalized version used for queries ("12.3.0"), or null when not strict semver. */
  version: string | null;
  versionStatus: VersionStatus;
  direct: boolean;
  dev: boolean;
  sourceType: string | null;
  sourceUrl: string | null;
  sourceReference: string | null;
  distUrl: string | null;
  releasedAt: string | null;
  autoloadFiles: string[];
  scripts: string[];
}

export interface ParsedComposerLock {
  projectName: string | null;
  pluginApiVersion: string | null;
  entries: ComposerEntry[];
  dependencies: Dependency[];
  warnings: string[];
}

export type ComposerParseResult = { ok: true; lockfile: ParsedComposerLock } | { ok: false; error: ParseError };

/** "v1.2.3" -> "1.2.3"; four-part or dev versions stay as they are. */
export function normalizeComposerVersion(raw: string): string {
  return raw.replace(/^v(?=\d)/, "");
}

const REGISTRY_DIST = /^https:\/\/(api\.github\.com|codeload\.github\.com|repo\.packagist\.org|gitlab\.com|bitbucket\.org|packagist\.org)\//i;

function classify(pkg: ComposerPackage): { version: string | null; status: VersionStatus } {
  const normalized = normalizeComposerVersion(pkg.version);
  if (pkg.version.startsWith("dev-") || pkg.version.endsWith("-dev")) return { version: null, status: "non-semver" };
  const distUrl = pkg.dist?.url;
  if (pkg.source?.type === "path" || pkg.dist?.type === "path" || (distUrl !== undefined && !REGISTRY_DIST.test(distUrl))) {
    return { version: normalized, status: "non-registry" };
  }
  if (!isStrictSemver(normalized)) return { version: null, status: "non-semver" };
  return { version: normalized, status: "ok" };
}

export function parseComposerLock(
  lockContent: string,
  composerJsonContent: string | null = null,
  limits: ParserLimits = DEFAULT_PARSER_LIMITS,
): ComposerParseResult {
  const bytes = Buffer.byteLength(lockContent, "utf8");
  if (bytes > limits.maxBytes) {
    return { ok: false, error: { code: "too-large", message: `composer.lock is ${bytes} bytes; limit is ${limits.maxBytes} bytes.` } };
  }

  let json: unknown;
  try {
    json = JSON.parse(lockContent);
  } catch (err) {
    return { ok: false, error: { code: "malformed-json", message: `composer.lock is not valid JSON: ${err instanceof Error ? err.message : String(err)}` } };
  }
  const parsed = composerLockSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: { code: "invalid-schema", message: `composer.lock does not match the expected structure: ${issue ? `${issue.path.join(".") || "<root>"}: ${issue.message}` : "unknown issue"}` } };
  }

  const warnings: string[] = [];
  let direct = new Set<string>();
  let projectName: string | null = null;
  if (composerJsonContent !== null) {
    try {
      const cj = composerJsonSchema.safeParse(JSON.parse(composerJsonContent));
      if (cj.success) {
        direct = new Set([...Object.keys(cj.data.require ?? {}), ...Object.keys(cj.data["require-dev"] ?? {})]);
        projectName = cj.data.name ?? null;
      } else {
        warnings.push("composer.json does not match the expected structure; no dependency can be classified as direct.");
      }
    } catch {
      warnings.push("composer.json is not valid JSON; no dependency can be classified as direct.");
    }
  } else {
    warnings.push("composer.json not found next to composer.lock; no dependency can be classified as direct.");
  }

  const all = [...parsed.data.packages.map((p) => ({ p, dev: false })), ...(parsed.data["packages-dev"] ?? []).map((p) => ({ p, dev: true }))];
  if (all.length > limits.maxDependencies) {
    return { ok: false, error: { code: "too-many-dependencies", message: `composer.lock lists ${all.length} packages; limit is ${limits.maxDependencies}.` } };
  }

  const entries: ComposerEntry[] = all.map(({ p, dev }) => {
    const c = classify(p);
    return {
      name: p.name,
      rawVersion: p.version,
      version: c.version,
      versionStatus: c.status,
      direct: direct.has(p.name),
      dev,
      sourceType: p.source?.type ?? null,
      sourceUrl: p.source?.url ?? null,
      sourceReference: p.source?.reference ?? p.dist?.reference ?? null,
      distUrl: p.dist?.url ?? null,
      releasedAt: p.time ?? null,
      autoloadFiles: p.autoload?.files ?? [],
      scripts: Object.keys(p.scripts ?? {}),
    };
  });

  const dependencies: Dependency[] = entries
    .map((e) => ({
      name: e.name,
      version: e.version ?? e.rawVersion,
      ecosystem: "Packagist" as const,
      versionStatus: e.versionStatus,
      exposure: { direct: e.direct, production: !e.dev },
      paths: [e.dev ? `packages-dev/${e.name}` : `packages/${e.name}`],
      sourceReference: e.sourceReference,
      sourceUrl: e.sourceUrl,
      releasedAt: e.releasedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ok: true,
    lockfile: { projectName, pluginApiVersion: parsed.data["plugin-api-version"] ?? null, entries, dependencies, warnings },
  };
}

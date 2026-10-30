import { z } from "zod";
import { finish, reachable, splitAt, versionStatusOf, type ManifestInfo, type ParsedJsLock } from "./js-lock.js";
import { DEFAULT_PARSER_LIMITS, type LockfileEntry, type ParseError, type ParserLimits } from "./lockfile.js";
import { flowField, parseYamlDocuments } from "./yaml-subset.js";

/**
 * pnpm-lock.yaml, lockfileVersion 9 (pnpm 9 and later). Read as text through
 * the YAML subset, validated with Zod, never executed.
 *
 *   importers   per workspace package: dependencies / devDependencies /
 *               optionalDependencies, each { specifier, version }
 *   packages    "name@version" -> { resolution: {integrity | tarball | git} }
 *   snapshots   "name@version(peers…)" -> { dependencies, optionalDependencies }
 *
 * Direct: referenced by any importer. Production: reachable from an
 * importer's dependencies or optionalDependencies through the snapshots;
 * everything else is dev. pnpm 11+ writes the package manager's own lock as a
 * first YAML document; only the project document (the last) is analyzed.
 */

export type PnpmParseResult = { ok: true; lockfile: ParsedJsLock } | { ok: false; error: ParseError };

// YAML writes empty maps as "{}" (or nothing); the subset reader keeps that text.
const emptyAsMap = (v: unknown): unknown => (v === "{}" || v === "" ? {} : v);
const ref = z.looseObject({ specifier: z.string().optional(), version: z.string() });
const refs = z.preprocess(emptyAsMap, z.record(z.string(), ref)).optional();
const names = z.preprocess(emptyAsMap, z.record(z.string(), z.string())).optional();
const importerSchema = z.preprocess(emptyAsMap, z.looseObject({ dependencies: refs, devDependencies: refs, optionalDependencies: refs }));
const packageSchema = z.preprocess(emptyAsMap, z.looseObject({ resolution: z.string().optional(), requiresBuild: z.string().optional(), version: z.string().optional() }));
const snapshotSchema = z.preprocess(emptyAsMap, z.looseObject({ dependencies: names, optionalDependencies: names }));
const lockSchema = z.looseObject({
  lockfileVersion: z.string(),
  importers: z.preprocess(emptyAsMap, z.record(z.string(), importerSchema)).optional(),
  packages: z.preprocess(emptyAsMap, z.record(z.string(), packageSchema)).optional(),
  snapshots: z.preprocess(emptyAsMap, z.record(z.string(), snapshotSchema)).optional(),
});

/** "1.2.3(react@18.2.0)" -> "1.2.3". */
function base(version: string): string {
  const paren = version.indexOf("(");
  return paren < 0 ? version : version.slice(0, paren);
}

/** The packages key an importer or snapshot reference points to, or null for workspace links and local folders. */
function packageKey(name: string, version: string): string | null {
  const b = base(version);
  if (b.startsWith("link:") || b.startsWith("workspace:")) return null;
  // An alias ("string-width-cjs: string-width@4.2.3") names the real package in the version.
  return splitAt(b) !== null && !/^\d/.test(b) ? b : `${name}@${b}`;
}

/** The snapshots key for a reference, keeping the peer suffix. */
function snapshotKey(name: string, version: string): string {
  return splitAt(base(version)) !== null && !/^\d/.test(version) ? version : `${name}@${version}`;
}

export function parsePnpmLock(content: string, manifest: ManifestInfo | null, limits: ParserLimits = DEFAULT_PARSER_LIMITS): PnpmParseResult {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > limits.maxBytes) return { ok: false, error: { code: "too-large", message: `Lockfile is ${String(bytes)} bytes; limit is ${String(limits.maxBytes)} bytes.` } };

  const docs = parseYamlDocuments(content);
  if (!docs.ok) return { ok: false, error: { code: "malformed-yaml", message: `pnpm-lock.yaml line ${String(docs.line)}: ${docs.message}` } };
  const withVersion = docs.documents.filter((d) => typeof d.lockfileVersion === "string");
  const doc = withVersion[withVersion.length - 1];
  if (!doc) return { ok: false, error: { code: "invalid-schema", message: "pnpm-lock.yaml has no lockfileVersion." } };

  const version = typeof doc.lockfileVersion === "string" ? doc.lockfileVersion : "";
  if (!/^9(\.\d+)?$/.test(version)) {
    return { ok: false, error: { code: "unsupported-lockfile-version", message: `pnpm lockfileVersion ${version.slice(0, 20)} is not supported. Supported: 9 (pnpm 9 and later).` } };
  }
  const parsed = lockSchema.safeParse(doc);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: { code: "invalid-schema", message: `pnpm-lock.yaml does not match the expected structure: ${issue ? `${issue.path.join(".") || "<root>"}: ${issue.message}` : "unknown issue"}` } };
  }
  const lock = parsed.data;
  const packages = lock.packages ?? {};
  const keys = Object.keys(packages);
  if (keys.length > limits.maxDependencies) {
    return { ok: false, error: { code: "too-many-dependencies", message: `Lockfile lists ${String(keys.length)} packages; limit is ${String(limits.maxDependencies)}.` } };
  }

  const warnings: string[] = [];
  if (withVersion.length > 1) warnings.push("pnpm-lock.yaml also holds the package manager's own lock (pnpm itself); only the project's dependencies were analyzed.");

  const direct = new Set<string>();
  const prodRoots: string[] = [];
  const devRoots: string[] = [];
  for (const [importer, deps] of Object.entries(lock.importers ?? {})) {
    const groups: [Record<string, { version: string }> | undefined, boolean][] = [
      [deps.dependencies, true],
      [deps.optionalDependencies, true],
      [deps.devDependencies, false],
    ];
    for (const [group, prod] of groups) {
      for (const [name, r] of Object.entries(group ?? {})) {
        const key = packageKey(name, r.version);
        if (key === null) {
          warnings.push(`Skipped "${name}" in importer "${importer}": workspace link (${base(r.version).slice(0, 60)}); not queried.`);
          continue;
        }
        direct.add(key);
        (prod ? prodRoots : devRoots).push(snapshotKey(name, r.version));
      }
    }
  }

  const snapshots = lock.snapshots;
  let production: Set<string> | null = null;
  if (snapshots) {
    const edges = (node: string): string[] => {
      const s = snapshots[node];
      if (!s) return [];
      return [...Object.entries(s.dependencies ?? {}), ...Object.entries(s.optionalDependencies ?? {})].map(([n, v]) => snapshotKey(n, v));
    };
    production = new Set([...reachable(prodRoots, edges)].map((k) => {
      const split = splitAt(k);
      return split ? `${split.name}@${base(split.rest)}` : k;
    }));
  } else {
    warnings.push("pnpm-lock.yaml has no snapshots section; every package is treated as a production dependency.");
  }

  const entries: LockfileEntry[] = [];
  for (const key of keys) {
    const split = splitAt(key);
    if (!split) {
      warnings.push(`Skipped "${key.slice(0, 80)}": not a name@version key; not queried.`);
      continue;
    }
    const pkg = packages[key] ?? {};
    const resolution = pkg.resolution ?? "";
    const tarball = flowField(resolution, "tarball");
    const nonRegistry = tarball !== null || flowField(resolution, "repo") !== null || flowField(resolution, "directory") !== null || /^(link:|file:|https?:|git)/.test(split.rest);
    entries.push({
      path: key,
      name: split.name,
      // Git and tarball packages are keyed by URL and carry their own version field.
      version: pkg.version ?? split.rest,
      versionStatus: versionStatusOf(pkg.version ?? split.rest, nonRegistry),
      direct: direct.has(key),
      dev: production !== null && !production.has(key),
      optional: false,
      peer: false,
      resolved: tarball,
      integrity: flowField(resolution, "integrity"),
      hasInstallScript: pkg.requiresBuild === "true",
    });
  }
  return { ok: true, lockfile: finish("pnpm", 9, manifest?.name ?? null, entries, warnings) };
}

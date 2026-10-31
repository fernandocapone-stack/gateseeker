import { z } from "zod";
import { finish, reachable, splitAt, versionStatusOf, type ManifestInfo, type ParsedJsLock } from "./js-lock.js";
import { DEFAULT_PARSER_LIMITS, isNonRegistrySource, type LockfileEntry, type ParseError, type ParserLimits } from "./lockfile.js";
import { parseYamlSubset } from "./yaml-subset.js";

/**
 * yarn.lock, both formats, read as text and never executed:
 *
 *   v1 (Yarn 1)      its own line format: `"a@^1", "a@^1.2":` headers, then
 *                    `version "1.2.3"`, `resolved "…"`, `integrity …` and a
 *                    `dependencies:` block of `name "range"` lines;
 *   Berry (Yarn 2+)  YAML with __metadata; entries carry `resolution:
 *                    "name@npm:1.2.3"` and `dependencies` of descriptors.
 *
 * Neither format marks dev dependencies, so the root package.json decides:
 * direct means listed there; production means reachable from its
 * dependencies, optionalDependencies or peerDependencies. Without a
 * package.json every package is treated as production and none as direct.
 */

export type YarnParseResult = { ok: true; lockfile: ParsedJsLock } | { ok: false; error: ParseError };

interface Entry {
  specs: string[];
  name: string;
  version: string | null;
  resolved: string | null;
  integrity: string | null;
  nonRegistry: boolean;
  deps: string[]; // specs of children, "name@range" (v1) or "name@descriptor" (Berry)
}

const v1EntrySchema = z.object({
  specs: z.array(z.string().min(1)).min(1),
  fields: z.record(z.string(), z.string()),
  dependencies: z.record(z.string(), z.string()),
});

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

/** "name value" with either side optionally quoted. */
function pair(line: string): [string, string] | null {
  const t = line.trim();
  let key: string;
  let rest: string;
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    if (end < 0) return null;
    key = t.slice(1, end);
    rest = t.slice(end + 1);
  } else {
    const sp = t.indexOf(" ");
    if (sp < 0) return null;
    key = t.slice(0, sp);
    rest = t.slice(sp);
  }
  return [key, unquote(rest)];
}

/** The registry package behind a spec, following npm aliases ("alias@npm:real@^1"). */
function realName(spec: string): string | null {
  const s = splitAt(spec);
  if (!s) return null;
  if (s.rest.startsWith("npm:")) {
    const inner = splitAt(s.rest.slice(4));
    if (inner && !/^[\d^~<>=*]/.test(inner.name)) return inner.name;
  }
  return s.name;
}

function parseV1(content: string, limits: ParserLimits): { ok: true; entries: Entry[] } | { ok: false; error: ParseError } {
  const entries: Entry[] = [];
  const lines = content.split(/\r?\n/);
  let current: { specs: string[]; fields: Record<string, string>; dependencies: Record<string, string>; line: number } | null = null;
  let block: string | null = null;
  const close = (): ParseError | null => {
    if (!current) return null;
    const v = v1EntrySchema.safeParse(current);
    if (!v.success) return { code: "invalid-schema", message: `yarn.lock entry at line ${String(current.line)} does not match the expected structure.` };
    const name = realName(v.data.specs[0] ?? "");
    if (name === null) return { code: "invalid-schema", message: `yarn.lock entry at line ${String(current.line)} has no name@range header.` };
    const resolved = v.data.fields.resolved ?? null;
    const firstRange = splitAt(v.data.specs[0] ?? "")?.rest ?? "";
    entries.push({
      specs: v.data.specs,
      name,
      version: v.data.fields.version ?? null,
      resolved,
      integrity: v.data.fields.integrity ?? null,
      nonRegistry: isNonRegistrySource(resolved ?? undefined) || /^(file:|link:|git|github:|https?:)/.test(firstRange),
      deps: Object.entries(v.data.dependencies).map(([n, r]) => `${n}@${r}`),
    });
    if (entries.length > limits.maxDependencies) return { code: "too-many-dependencies", message: `Lockfile lists more than ${String(limits.maxDependencies)} packages.` };
    current = null;
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "" || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      const err = close();
      if (err) return { ok: false, error: err };
      if (!raw.trimEnd().endsWith(":")) return { ok: false, error: { code: "malformed-lockfile", message: `yarn.lock line ${String(i + 1)}: expected an entry header ending with ":".` } };
      const specs = raw.trimEnd().slice(0, -1).split(/,\s*/).map(unquote).filter((s) => s !== "");
      current = { specs, fields: {}, dependencies: {}, line: i + 1 };
      block = null;
      continue;
    }
    if (!current) return { ok: false, error: { code: "malformed-lockfile", message: `yarn.lock line ${String(i + 1)}: indented line before any entry.` } };
    if (indent <= 2) {
      const t = raw.trim();
      if (t.endsWith(":") && !t.includes(" ")) {
        block = t.slice(0, -1);
        continue;
      }
      block = null;
      const kv = pair(t);
      if (!kv) return { ok: false, error: { code: "malformed-lockfile", message: `yarn.lock line ${String(i + 1)}: expected "field value".` } };
      if (kv[0] === "__proto__" || kv[0] === "constructor") continue;
      current.fields[kv[0]] = kv[1];
      continue;
    }
    if (block === "dependencies" || block === "optionalDependencies") {
      const kv = pair(raw);
      if (!kv) return { ok: false, error: { code: "malformed-lockfile", message: `yarn.lock line ${String(i + 1)}: expected "name range".` } };
      if (kv[0] !== "__proto__" && kv[0] !== "constructor") current.dependencies[kv[0]] = kv[1];
    }
  }
  const err = close();
  return err ? { ok: false, error: err } : { ok: true, entries };
}

const berryEntrySchema = z.looseObject({
  version: z.string().optional(),
  resolution: z.string(),
  checksum: z.string().optional(),
  dependencies: z.preprocess((v) => (v === "{}" || v === "" ? {} : v), z.record(z.string(), z.string())).optional(),
  optionalDependencies: z.preprocess((v) => (v === "{}" || v === "" ? {} : v), z.record(z.string(), z.string())).optional(),
});

/** "patch:typescript@npm%3A^5.4#…" -> "typescript@npm:^5.4"; plain descriptors pass through. */
function unpatch(descriptor: string): string {
  if (!descriptor.startsWith("patch:")) return descriptor;
  const inner = descriptor.slice("patch:".length).split("#")[0] ?? "";
  try {
    return decodeURIComponent(inner);
  } catch {
    return inner;
  }
}

interface BerryOut {
  entries: Entry[];
  workspaceDeps: string[];
  version: number | null;
  skippedPatches: number;
}

function parseBerry(content: string, limits: ParserLimits): { ok: true; out: BerryOut } | { ok: false; error: ParseError } {
  const doc = parseYamlSubset(content);
  if (!doc.ok) return { ok: false, error: { code: "malformed-yaml", message: `yarn.lock line ${String(doc.line)}: ${doc.message}` } };
  const meta = doc.value.__metadata;
  const version = typeof meta === "object" && !Array.isArray(meta) && typeof meta.version === "string" ? Number(meta.version) : null;
  const entries: Entry[] = [];
  const workspaceDeps: string[] = [];
  let skippedPatches = 0;
  for (const [key, raw] of Object.entries(doc.value)) {
    if (key === "__metadata") continue;
    const v = berryEntrySchema.safeParse(raw);
    if (!v.success) return { ok: false, error: { code: "invalid-schema", message: `yarn.lock entry "${key.slice(0, 80)}" does not match the expected structure.` } };
    const res = splitAt(v.data.resolution);
    if (!res) return { ok: false, error: { code: "invalid-schema", message: `yarn.lock entry "${key.slice(0, 80)}" has an unreadable resolution.` } };
    const protocol = res.rest.slice(0, res.rest.indexOf(":") + 1);
    const deps = [...Object.entries(v.data.dependencies ?? {}), ...Object.entries(v.data.optionalDependencies ?? {})].map(([n, d]) => unpatch(`${n}@${d}`.replace(`${n}@patch:`, "patch:")));
    if (protocol === "workspace:") {
      workspaceDeps.push(...deps);
      continue;
    }
    if (protocol === "patch:") {
      skippedPatches++;
      continue;
    }
    entries.push({
      specs: key.split(/,\s*/).map((s) => s.trim()).filter((s) => s !== ""),
      name: res.name,
      version: v.data.version ?? null,
      resolved: protocol === "npm:" ? null : v.data.resolution,
      integrity: v.data.checksum ?? null,
      nonRegistry: protocol !== "npm:",
      deps,
    });
    if (entries.length > limits.maxDependencies) return { ok: false, error: { code: "too-many-dependencies", message: `Lockfile lists more than ${String(limits.maxDependencies)} packages.` } };
  }
  return { ok: true, out: { entries, workspaceDeps, version, skippedPatches } };
}

export function parseYarnLock(content: string, manifest: ManifestInfo | null, limits: ParserLimits = DEFAULT_PARSER_LIMITS): YarnParseResult {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > limits.maxBytes) return { ok: false, error: { code: "too-large", message: `Lockfile is ${String(bytes)} bytes; limit is ${String(limits.maxBytes)} bytes.` } };

  const berry = /^__metadata:/m.test(content);
  const warnings: string[] = [];
  let entries: Entry[];
  let rootDeps: string[] = [];
  let lockfileVersion: number | null = null;
  if (berry) {
    const r = parseBerry(content, limits);
    if (!r.ok) return r;
    entries = r.out.entries;
    rootDeps = r.out.workspaceDeps;
    lockfileVersion = r.out.version;
    if (r.out.skippedPatches > 0) warnings.push(`${String(r.out.skippedPatches)} patched package(s) (patch: protocol) were not queried separately; the npm version they patch is queried.`);
  } else {
    const r = parseV1(content, limits);
    if (!r.ok) return r;
    entries = r.entries;
  }

  // Index every spec ("name@range", "name@npm:range") to its entry.
  const bySpec = new Map<string, Entry>();
  for (const e of entries) {
    for (const s of e.specs) {
      bySpec.set(s, e);
      const split = splitAt(s);
      if (split && !split.rest.startsWith("npm:") && !/^[a-z]+:/.test(split.rest)) bySpec.set(`${split.name}@npm:${split.rest}`, e);
    }
  }
  const find = (spec: string): Entry | undefined => {
    const hit = bySpec.get(spec);
    if (hit) return hit;
    const split = splitAt(spec);
    return split ? bySpec.get(`${split.name}@npm:${split.rest}`) : undefined;
  };

  // Roots: the package.json when present; for Berry, the workspace entries fill in when it is not.
  let prodRoots: string[];
  let devRoots: string[];
  if (manifest) {
    prodRoots = [...manifest.prod].map(([n, r]) => `${n}@${r}`);
    devRoots = [...manifest.dev].map(([n, r]) => `${n}@${r}`);
    if (berry) {
      // Berry stores descriptors with the npm: protocol; package.json does not.
      const devNames = new Set(manifest.dev.keys());
      for (const d of rootDeps) {
        const split = splitAt(d);
        if (split && !manifest.prod.has(split.name) && !devNames.has(split.name)) prodRoots.push(d);
      }
    }
  } else {
    prodRoots = rootDeps;
    devRoots = [];
    warnings.push("No package.json next to yarn.lock: direct dependencies are unknown and every package is treated as production.");
  }

  const directEntries = new Set<Entry>();
  for (const s of [...prodRoots, ...devRoots]) {
    const e = find(s);
    if (e) directEntries.add(e);
  }
  const indexOf = new Map(entries.map((e, i) => [e, String(i)]));
  const toId = (spec: string): string | null => {
    const e = find(spec);
    return e ? (indexOf.get(e) ?? null) : null;
  };
  const prodIds = reachable(
    prodRoots.map(toId).filter((x): x is string => x !== null),
    (id) => (entries[Number(id)]?.deps ?? []).map(toId).filter((x): x is string => x !== null),
  );
  const everyoneProd = !manifest;

  const out: LockfileEntry[] = entries.map((e, i) => ({
    path: e.specs.join(", "),
    name: e.name,
    version: e.version,
    versionStatus: versionStatusOf(e.version, e.nonRegistry),
    direct: directEntries.has(e),
    dev: !everyoneProd && !prodIds.has(String(i)),
    optional: false,
    peer: false,
    resolved: e.resolved,
    integrity: e.integrity,
    hasInstallScript: false,
  }));
  return { ok: true, lockfile: finish(berry ? "yarn-berry" : "yarn-v1", lockfileVersion, manifest?.name ?? null, out, warnings) };
}

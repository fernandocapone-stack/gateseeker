import type { Dependency, VersionStatus } from "../types.js";
import { aggregate, isStrictSemver, type LockfileEntry } from "./lockfile.js";

/**
 * Shared pieces of the pnpm and Yarn readers. Both produce the same
 * LockfileEntry list as package-lock.json, so OSV queries, curated
 * advisories, supply-chain rules and priorities work unchanged.
 */

export type JsLockFormat = "pnpm" | "yarn-v1" | "yarn-berry";

export interface ParsedJsLock {
  format: JsLockFormat;
  /** pnpm "9.0" -> 9; Yarn Berry __metadata.version; null for Yarn v1. */
  lockfileVersion: number | null;
  projectName: string | null;
  entries: LockfileEntry[];
  dependencies: Dependency[];
  warnings: string[];
}

/** "lodash@4.17.20" / "@scope/pkg@1.0.0" -> name and the rest; null when there is no version separator. */
export function splitAt(spec: string): { name: string; rest: string } | null {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  if (at <= 0) return null;
  return { name: spec.slice(0, at), rest: spec.slice(at + 1) };
}

export function versionStatusOf(version: string | null, nonRegistry: boolean): VersionStatus {
  if (version === null || version === "") return "missing";
  if (nonRegistry) return "non-registry";
  return isStrictSemver(version) ? "ok" : "non-semver";
}

/** Marks every node reachable from `starts` through `edges` (iterative, each node visited once). */
export function reachable(starts: Iterable<string>, edges: (node: string) => Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) continue;
    seen.add(node);
    for (const next of edges(node)) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

export function finish(format: JsLockFormat, lockfileVersion: number | null, projectName: string | null, entries: LockfileEntry[], warnings: string[]): ParsedJsLock {
  return { format, lockfileVersion, projectName, entries, dependencies: aggregate(entries, "npm"), warnings };
}

/** package.json fields the readers use to tell direct and dev dependencies apart; anything else is ignored. */
export interface ManifestInfo {
  name: string | null;
  prod: Map<string, string>;
  dev: Map<string, string>;
}

export function readManifest(text: string | null): ManifestInfo | null {
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const map = (v: unknown): Map<string, string> => {
    const out = new Map<string, string>();
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      for (const [k, r] of Object.entries(v as Record<string, unknown>)) if (typeof r === "string") out.set(k, r);
    }
    return out;
  };
  const prod = new Map([...map(o.dependencies), ...map(o.optionalDependencies), ...map(o.peerDependencies)]);
  return { name: typeof o.name === "string" ? o.name : null, prod, dev: map(o.devDependencies) };
}

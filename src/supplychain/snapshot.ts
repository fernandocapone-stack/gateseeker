import { createHash } from "node:crypto";
import type { ParsedComposerLock } from "../parser/composer.js";
import type { ParsedLockfile } from "../parser/lockfile.js";
import type { Ecosystem } from "../types.js";

/**
 * Ecosystem-neutral view of a lockfile for the structural supply-chain rules.
 * Packages are keyed by name; when a name appears with several versions (npm
 * nested copies) all of them are kept and the pairwise rules skip that name.
 */

export interface LockPackage {
  name: string;
  version: string;
  rawVersion: string;
  /** Commit the lock pins (Composer `source.reference`) or the npm integrity hash. */
  reference: string | null;
  /** Host of the VCS source or the dist/tarball URL. */
  sourceHost: string | null;
  /** True when the version resolves to a branch or commit rather than a published release. */
  pinnedToCommit: boolean;
  hasInstallScript: boolean;
  installScripts: string[];
  autoloadFiles: string[];
  releasedAt: string | null;
  dev: boolean;
  direct: boolean;
}

export interface LockSnapshot {
  ecosystem: Ecosystem;
  path: string;
  sha256: string;
  packages: Map<string, LockPackage[]>;
}

function host(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.replace(/^git\+/, ""));
    return u.hostname.toLowerCase();
  } catch {
    const m = /^(?:git@|ssh:\/\/git@)?([^:/]+)[:/]/.exec(url);
    return m?.[1]?.toLowerCase() ?? null;
  }
}

function add(map: Map<string, LockPackage[]>, p: LockPackage): void {
  const list = map.get(p.name);
  if (list) list.push(p);
  else map.set(p.name, [p]);
}

export function snapshotFromComposer(lock: ParsedComposerLock, path: string, content: string): LockSnapshot {
  const packages = new Map<string, LockPackage[]>();
  for (const e of lock.entries) {
    add(packages, {
      name: e.name,
      version: e.version ?? e.rawVersion,
      rawVersion: e.rawVersion,
      reference: e.sourceReference,
      sourceHost: host(e.sourceUrl) ?? host(e.distUrl),
      pinnedToCommit: e.rawVersion.startsWith("dev-") || e.rawVersion.endsWith("-dev"),
      hasInstallScript: e.scripts.length > 0,
      installScripts: e.scripts,
      autoloadFiles: e.autoloadFiles,
      releasedAt: e.releasedAt,
      dev: e.dev,
      direct: e.direct,
    });
  }
  return { ecosystem: "Packagist", path, sha256: sha(content), packages };
}

export function snapshotFromNpm(lock: ParsedLockfile, path: string, content: string): LockSnapshot {
  const packages = new Map<string, LockPackage[]>();
  for (const e of lock.entries) {
    add(packages, {
      name: e.name,
      version: e.version ?? "<missing>",
      rawVersion: e.version ?? "<missing>",
      reference: e.integrity,
      sourceHost: host(e.resolved),
      pinnedToCommit: e.versionStatus === "non-registry",
      hasInstallScript: e.hasInstallScript,
      installScripts: e.hasInstallScript ? ["install"] : [],
      autoloadFiles: [],
      releasedAt: null,
      dev: e.dev,
      direct: e.direct,
    });
  }
  return { ecosystem: "npm", path, sha256: sha(content), packages };
}

function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

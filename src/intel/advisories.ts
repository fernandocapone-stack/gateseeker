import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemver } from "../parser/lockfile.js";
import type { Dependency, Finding } from "../types.js";
import { validateAdvisory, type Advisory } from "./advisory-schema.js";
import type { PackagistClient } from "./packagist.js";
import { decidePriority } from "../rules/priority.js";
import { supplyChainGuidance } from "../rules/remediation/dependencies.js";

/**
 * Loading and matching of curated advisories.
 *
 * Resolution order for the advisory set:
 *   1. an explicit path (`--advisories`), file with an array or one record;
 *   2. the bundled `advisories.json` produced at build time next to `dist/`;
 *   3. in a source checkout, `advisories/approved/*.json`;
 *   4. otherwise an empty set, declared as such.
 * Only `approved` records are kept; anything else is dropped at load time.
 */

export const ADVISORY_SOURCE_NAME = "gateseeker-advisories";

export interface AdvisorySet {
  advisories: Advisory[];
  /** Where the set came from, for the report. */
  origin: string;
  /** sha256 of the canonical JSON, so two runs can be compared. */
  digest: string;
  /** Problems found while loading (invalid files are skipped, never silently). */
  problems: string[];
}

function canonical(advisories: Advisory[]): string {
  return JSON.stringify([...advisories].sort((a, b) => a.id.localeCompare(b.id)));
}

function finish(advisories: Advisory[], origin: string, problems: string[]): AdvisorySet {
  const approved = advisories.filter((a) => a.status === "approved");
  const ids = new Set<string>();
  for (const a of approved) {
    if (ids.has(a.id)) problems.push(`duplicate advisory id ${a.id}`);
    ids.add(a.id);
  }
  return { advisories: approved, origin, digest: createHash("sha256").update(canonical(approved)).digest("hex").slice(0, 16), problems };
}

export function parseAdvisoryJson(text: string, label: string): { advisories: Advisory[]; problems: string[] } {
  const problems: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { advisories: [], problems: [`${label}: invalid JSON (${err instanceof Error ? err.message : String(err)})`] };
  }
  const items = Array.isArray(json) ? json : [json];
  const advisories: Advisory[] = [];
  items.forEach((item, i) => {
    const v = validateAdvisory(item);
    if (v.ok) advisories.push(v.advisory);
    else problems.push(`${label}${Array.isArray(json) ? `[${i}]` : ""}: ${v.issues.join("; ")}`);
  });
  return { advisories, problems };
}

export async function loadAdvisoryDirectory(dir: string): Promise<{ advisories: Advisory[]; problems: string[] }> {
  const advisories: Advisory[] = [];
  const problems: string[] = [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { advisories, problems: [`cannot read ${dir}`] };
  }
  for (const n of names) {
    const r = parseAdvisoryJson(await readFile(join(dir, n), "utf8"), join(dir, n));
    advisories.push(...r.advisories);
    problems.push(...r.problems);
  }
  return { advisories, problems };
}

export async function loadAdvisories(options: { path?: string } = {}): Promise<AdvisorySet> {
  if (options.path !== undefined) {
    let text: string;
    try {
      text = await readFile(options.path, "utf8");
    } catch (err) {
      return finish([], options.path, [`cannot read ${options.path}: ${err instanceof Error ? err.message : String(err)}`]);
    }
    const r = parseAdvisoryJson(text, options.path);
    return finish(r.advisories, options.path, r.problems);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  // dist/intel/advisories.js -> dist/advisories.json ; src/intel/advisories.ts -> (none)
  const bundled = join(here, "..", "advisories.json");
  try {
    const text = await readFile(bundled, "utf8");
    const r = parseAdvisoryJson(text, "bundled advisories.json");
    return finish(r.advisories, "bundled", r.problems);
  } catch {
    /* not built or running from source */
  }

  const checkout = join(here, "..", "..", "advisories", "approved");
  const r = await loadAdvisoryDirectory(checkout);
  if (!r.problems.some((p) => p.startsWith("cannot read"))) {
    return finish(r.advisories, "checkout:advisories/approved", r.problems);
  }
  return finish([], "none", ["no advisory set found (not built and no advisories/approved directory)"]);
}

/** Version-based match (npm and Composer): exact versions and semver ranges. Synchronous, no network. */
export function advisoryMatches(advisory: Advisory, dep: Dependency): boolean {
  if (advisory.status !== "approved") return false;
  if (advisory.ecosystem !== dep.ecosystem) return false;
  if (dep.version === null || dep.versionStatus !== "ok") return false;
  for (const p of advisory.packages) {
    if (p.name !== dep.name) continue;
    if (p.affected.versions?.includes(dep.version)) return true;
    for (const r of p.affected.ranges ?? []) {
      const geIntroduced = compareSemver(dep.version, r.introduced) >= 0;
      const ltFixed = r.fixed === undefined || compareSemver(dep.version, r.fixed) < 0;
      if (geIntroduced && ltFixed) return true;
    }
  }
  return false;
}

export interface TagMatchResult {
  matched: boolean;
  verification: "verified" | "unverified" | "not-applicable";
  /** Present when the registry lookup failed; the scan records a failed query for it. */
  lookupError: string | null;
  details: Record<string, string | number | boolean | null>;
}

/**
 * Tag-rewrite match for Composer: the advisory lists affected tags ("*" or
 * specific ones) and the instant after which commits are suspicious. The
 * dependency is affected when the lock's commit differs from the commit the
 * registry reports for that version today (the tag was rewritten and later
 * restored), or when the lock's release time falls inside the window (the
 * rewritten tag is what the registry still serves). Without the registry the
 * time check alone decides, marked unverified.
 */
export async function advisoryTagMatch(advisory: Advisory, dep: Dependency, packagist: PackagistClient | null): Promise<TagMatchResult> {
  const none: TagMatchResult = { matched: false, verification: "not-applicable", lookupError: null, details: {} };
  if (advisory.status !== "approved" || advisory.ecosystem !== "Packagist" || dep.ecosystem !== "Packagist") return none;
  const pkg = advisory.packages.find((p) => p.name === dep.name);
  if (!pkg?.affected.tags?.length || !pkg.affected.commits_after) return none;
  const version = dep.version ?? "";
  const tagListed = pkg.affected.tags.includes("*") || pkg.affected.tags.some((t) => t.replace(/^v/, "") === version.replace(/^v/, ""));
  if (!tagListed) return none;

  const after = Date.parse(pkg.affected.commits_after);
  const end = advisory.window.end ? Date.parse(advisory.window.end) : Number.POSITIVE_INFINITY;
  const within = (iso: string | null | undefined): boolean => {
    const t = iso ? Date.parse(iso) : Number.NaN;
    return Number.isFinite(t) && t >= after && t <= end;
  };
  // The commits that rewrote the tags are dated inside the window; a lock (or a registry) that
  // reports such a date for this version pinned one of them.
  const lockInWindow = within(dep.releasedAt);
  const details: Record<string, string | number | boolean | null> = {
    lockReference: dep.sourceReference ?? null,
    lockReleasedAt: dep.releasedAt ?? null,
    commitsAfter: pkg.affected.commits_after,
    windowEnd: advisory.window.end,
    lockInWindow,
  };

  if (packagist === null || !dep.sourceReference) {
    return { matched: lockInWindow, verification: "unverified", lookupError: packagist === null ? "registry lookup disabled" : "lock has no source reference", details };
  }
  const current = await packagist.currentReference(dep.name, version);
  if (current.status === "failed") {
    return { matched: lockInWindow, verification: "unverified", lookupError: current.error, details };
  }
  if (current.status === "not-found") {
    return { matched: lockInWindow, verification: "unverified", lookupError: `version ${version} not found on Packagist`, details };
  }
  const mismatch = current.reference !== null && current.reference !== dep.sourceReference;
  const registryInWindow = within(current.time);
  return {
    matched: mismatch || registryInWindow,
    verification: "verified",
    lookupError: null,
    details: { ...details, registryReference: current.reference, registryReleasedAt: current.time, referenceMismatch: mismatch, registryInWindow },
  };
}

export function buildAdvisoryFinding(dep: Dependency, advisory: Advisory, queriedAt: string, tag?: TagMatchResult): Finding {
  const pkg = advisory.packages.find((p) => p.name === dep.name);
  const fixedIn = pkg?.affected.fixed_in ?? null;
  const fixedVersions = [...new Set([...(fixedIn ? [fixedIn] : []), ...(pkg?.affected.ranges ?? []).map((r) => r.fixed).filter((f): f is string => f !== undefined)])];
  const decision = decidePriority({ severity: advisory.severity, exposure: dep.exposure, fixAvailable: fixedVersions.length > 0 });
  decision.rationale.unshift(`advisory:${advisory.id}`);
  const subject = `${dep.name}@${dep.version ?? "?"}`;
  return {
    id: `${advisory.id}::${subject}`,
    kind: "supply-chain-anomaly",
    subject,
    evidence: {
      kind: "supply-chain-anomaly",
      origin: "advisory",
      advisoryId: advisory.id,
      ruleId: null,
      type: advisory.type,
      summary: advisory.summary,
      indicators: advisory.indicators,
      window: advisory.window,
      reviewedBy: advisory.review.reviewed_by,
      reviewedAt: advisory.review.reviewed_at,
      verification: tag?.verification ?? "not-applicable",
      details: tag ? tag.details : null,
    },
    source: { name: ADVISORY_SOURCE_NAME, queriedAt },
    severity: { tier: advisory.severity, declared: advisory.severity, cvss: [] },
    priority: decision.priority,
    rationale: decision.rationale,
    remediation: {
      fixedVersions,
      action: tag?.verification === "unverified" ? `${advisory.remediation} (Registry check unavailable: verify the pinned commit manually against the package's repository.)` : advisory.remediation,
      ...supplyChainGuidance("advisory", dep.name),
    },
    references: advisory.sources.map((s) => ({ type: s.primary ? "PRIMARY" : "REPORT", url: s.url })),
    aiExplanation: null,
  };
}

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemver } from "../parser/lockfile.js";
import type { Dependency, Finding } from "../types.js";
import { validateAdvisory, type Advisory } from "./advisory-schema.js";
import { decidePriority } from "../rules/priority.js";

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

export function buildAdvisoryFinding(dep: Dependency, advisory: Advisory, queriedAt: string): Finding {
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
      advisoryId: advisory.id,
      type: advisory.type,
      summary: advisory.summary,
      indicators: advisory.indicators,
      window: advisory.window,
      reviewedBy: advisory.review.reviewed_by,
      reviewedAt: advisory.review.reviewed_at,
    },
    source: { name: ADVISORY_SOURCE_NAME, queriedAt },
    severity: { tier: advisory.severity, declared: advisory.severity, cvss: [] },
    priority: decision.priority,
    rationale: decision.rationale,
    remediation: { fixedVersions, action: advisory.remediation },
    references: advisory.sources.map((s) => ({ type: s.primary ? "PRIMARY" : "REPORT", url: s.url })),
    aiExplanation: null,
  };
}

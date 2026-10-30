import type { OsvVulnerability } from "../intel/osv-schema.js";
import { compareSemver } from "../parser/lockfile.js";
import type { Dependency, Finding } from "../types.js";
import { decidePriority } from "./priority.js";
import { dependencyGuidance } from "./remediation/dependencies.js";
import { deriveSeverity } from "./severity.js";

/**
 * Turns one OSV record about one dependency into a Finding.
 * Source data is copied, never rewritten; rule outputs are added alongside.
 */

/** Fixed versions declared by the source for exactly this package and ecosystem. */
export function extractFixedVersions(vuln: OsvVulnerability, dep: Dependency): string[] {
  const fixed = new Set<string>();
  for (const affected of vuln.affected ?? []) {
    if (affected.package?.name !== dep.name || affected.package.ecosystem !== dep.ecosystem) continue;
    for (const range of affected.ranges ?? []) {
      for (const event of range.events) {
        if (event.fixed !== undefined) fixed.add(event.fixed);
      }
    }
  }
  return [...fixed].sort(compareSemver);
}

/** Smallest fixed version above the installed one; otherwise the highest listed; null when none is published. */
function targetVersion(dep: Dependency, fixedVersions: string[]): string | null {
  if (fixedVersions.length === 0) return null;
  const above = dep.version === null ? [] : fixedVersions.filter((v) => compareSemver(v, dep.version ?? "") > 0);
  return above[0] ?? fixedVersions[fixedVersions.length - 1] ?? null;
}

function remediationAction(dep: Dependency, fixedVersions: string[]): string {
  const subject = `${dep.name}@${dep.version ?? "?"}`;
  const target = targetVersion(dep, fixedVersions);
  if (target === null) {
    return `No fixed version published for ${subject}. Check the references for mitigations or consider replacing the package.`;
  }
  const composer = dep.ecosystem === "Packagist";
  const manifest = composer ? "composer.json" : "package.json";
  const reinstall = composer ? "run composer update" : "reinstall";
  const pin = composer ? "or require it directly at that version" : "or add an npm override";
  const how = dep.exposure.direct
    ? `Update ${dep.name} to ${target} or later in ${manifest} and ${reinstall}.`
    : `Update the dependency that pulls in ${dep.name} so it resolves to ${target} or later (${pin}).`;
  return how;
}

export function buildFinding(
  dep: Dependency,
  vuln: OsvVulnerability,
  source: { name: string; queriedAt: string },
): Finding {
  const severity = deriveSeverity(vuln);
  const fixedVersions = extractFixedVersions(vuln, dep);
  const decision = decidePriority({
    severity: severity.tier,
    exposure: dep.exposure,
    fixAvailable: fixedVersions.length > 0,
  });
  const subject = `${dep.name}@${dep.version ?? "?"}`;

  return {
    id: `${vuln.id}::${subject}`,
    kind: "dependency-vulnerability",
    subject,
    evidence: {
      kind: "dependency-vulnerability",
      vulnerabilityId: vuln.id,
      aliases: vuln.aliases ?? [],
      summary: vuln.summary ?? null,
      details: vuln.details ?? null,
      published: vuln.published ?? null,
      modified: vuln.modified ?? null,
      affectedRanges: vuln.affected ?? null,
    },
    source,
    severity,
    priority: decision.priority,
    rationale: decision.rationale,
    remediation: {
      fixedVersions,
      action: remediationAction(dep, fixedVersions),
      ...dependencyGuidance({ name: dep.name, version: dep.version, ecosystem: dep.ecosystem, direct: dep.exposure.direct, vulnerabilityId: vuln.id, target: targetVersion(dep, fixedVersions) }),
    },
    references: (vuln.references ?? []).map((r) => ({ type: r.type, url: r.url })),
    aiExplanation: null,
  };
}

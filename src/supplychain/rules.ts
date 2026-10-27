import { sanitize } from "../report/text.js";
import { decidePriority } from "../rules/priority.js";
import type { Finding, SeverityTier } from "../types.js";
import type { LockPackage, LockSnapshot } from "./snapshot.js";

/**
 * Structural supply-chain signals. They read the lockfile (and optionally a
 * baseline lockfile) and nothing else; no network, no execution. They ship in
 * warn mode like the code-pattern rules until their precision is measured.
 */

export const SUPPLY_CHAIN_SOURCE_NAME = "gateseeker-supply-chain-rules";

export interface SupplyChainRuleOptions {
  now: () => Date;
  /** Packages released within this many days are flagged by GSK-SC-004 (0 disables). */
  maxReleaseAgeDays: number;
}

export interface BaselineDiff {
  packagesCompared: number;
  added: string[];
  removed: string[];
  changed: string[];
}

interface Match {
  ruleId: string;
  title: string;
  severity: SeverityTier;
  pkg: LockPackage;
  summary: string;
  indicators: string[];
  action: string;
  details: Record<string, string | number | boolean | null>;
}

const UNEXPOSED_NPM_HOSTS = new Set(["registry.npmjs.org", "registry.yarnpkg.com"]);

function single(list: LockPackage[] | undefined): LockPackage | null {
  return list?.length === 1 ? (list[0] ?? null) : null;
}

function matchesFor(current: LockSnapshot, baseline: LockSnapshot | null, opts: SupplyChainRuleOptions): Match[] {
  const out: Match[] = [];
  const nowMs = opts.now().getTime();

  for (const [name, list] of current.packages) {
    for (const pkg of list) {
      // GSK-SC-001: pinned to a branch/commit instead of a published version.
      if (pkg.pinnedToCommit && !pkg.dev) {
        out.push({
          ruleId: "GSK-SC-001",
          title: "Dependency pinned to a commit or branch, not a published version",
          severity: "MODERATE",
          pkg,
          summary: `${name} is installed from ${current.ecosystem === "npm" ? "a git or tarball URL" : `"${pkg.rawVersion}"`} rather than a published release; whoever controls that branch controls the code at the next install.`,
          indicators: [`version "${pkg.rawVersion}"`, ...(pkg.sourceHost ? [`source host ${pkg.sourceHost}`] : [])],
          action: "Pin a published, immutable version (or an exact commit you have reviewed) and prefer registry releases for production dependencies.",
          details: { rawVersion: pkg.rawVersion, sourceHost: pkg.sourceHost },
        });
      }
      // GSK-SC-004: very recent release of a package that already existed.
      if (opts.maxReleaseAgeDays > 0 && pkg.releasedAt && !pkg.dev) {
        const ageDays = (nowMs - Date.parse(pkg.releasedAt)) / 86_400_000;
        const previous = baseline ? single(baseline.packages.get(name)) : null;
        if (Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= opts.maxReleaseAgeDays && (baseline === null || (previous !== null && previous.version !== pkg.version))) {
          out.push({
            ruleId: "GSK-SC-004",
            title: "Very recent release",
            severity: "LOW",
            pkg,
            summary: `${name}@${pkg.version} was published ${ageDays.toFixed(1)} day(s) ago. Most supply-chain compromises are caught within days; waiting gives the ecosystem time to react.`,
            indicators: [`released ${pkg.releasedAt}`],
            action: "Consider holding the update for a few days unless it fixes a known vulnerability, and check the release notes and the publisher's channels.",
            details: { releasedAt: pkg.releasedAt, ageDays: Number(ageDays.toFixed(1)), previousVersion: previous?.version ?? null },
          });
        }
      }
    }
  }

  if (!baseline) return out;

  for (const [name, list] of current.packages) {
    const cur = single(list);
    const base = single(baseline.packages.get(name));
    if (!cur || !base) continue;

    // GSK-SC-003: same version, different commit/integrity: the signature of a rewritten tag.
    // Branch "versions" (dev-main, 1.x-dev) move with every commit by design; GSK-SC-001 covers those.
    if (cur.version === base.version && !cur.pinnedToCommit && !base.pinnedToCommit && cur.reference && base.reference && cur.reference !== base.reference) {
      out.push({
        ruleId: "GSK-SC-003",
        title: "Same version now resolves to different content",
        severity: "CRITICAL",
        pkg: cur,
        summary: `${name}@${cur.version} points at ${current.ecosystem === "npm" ? "a different integrity hash" : "a different commit"} than the baseline lockfile for the very same version. Published versions must not change; this is how rewritten tags and replaced artifacts look.`,
        indicators: [`baseline ${short(base.reference)}`, `current ${short(cur.reference)}`],
        action: "Do not install. Compare the two references with the package's repository, check the publisher's security channels, and pin the baseline reference until the change is explained.",
        details: { version: cur.version, baselineReference: base.reference, currentReference: cur.reference },
      });
    }

    // GSK-SC-002: install hooks or autoload files appeared in a package that already existed.
    const newAutoload = cur.autoloadFiles.filter((f) => !base.autoloadFiles.includes(f));
    const newScripts = cur.installScripts.filter((s) => !base.installScripts.includes(s));
    if (newAutoload.length > 0 || newScripts.length > 0) {
      // Same version with new install-time code is the tag-rewrite pattern (HIGH); a version
      // bump that adds bootstrap code is usually a legitimate release and only deserves a look (MODERATE).
      const sameVersion = cur.version === base.version;
      out.push({
        ruleId: "GSK-SC-002",
        title: "New install-time code in an existing dependency",
        severity: sameVersion ? "HIGH" : "MODERATE",
        pkg: cur,
        summary: `${name} gained ${[newAutoload.length > 0 ? `autoload files (${newAutoload.join(", ")})` : "", newScripts.length > 0 ? `install scripts (${newScripts.join(", ")})` : ""].filter(Boolean).join(" and ")} ${sameVersion ? "without a version change" : `between ${base.version} and ${cur.version}`}. Code that runs at install or bootstrap is the preferred vehicle for credential stealers${sameVersion ? "" : "; in a normal release it still deserves a look"}.`,
        indicators: [...newAutoload.map((f) => `autoload.files + ${f}`), ...newScripts.map((s) => `script + ${s}`)],
        action: "Read the added file or script in the package's repository before installing; if it is not explained by the changelog, treat the release as suspicious and pin the baseline version.",
        details: { fromVersion: base.version, toVersion: cur.version, newAutoloadFiles: newAutoload.join(","), newInstallScripts: newScripts.join(",") },
      });
    }

    // GSK-SC-005: source moved to another host.
    if (cur.sourceHost && base.sourceHost && cur.sourceHost !== base.sourceHost && !(UNEXPOSED_NPM_HOSTS.has(cur.sourceHost) && UNEXPOSED_NPM_HOSTS.has(base.sourceHost))) {
      out.push({
        ruleId: "GSK-SC-005",
        title: "Dependency source moved to another host",
        severity: "HIGH",
        pkg: cur,
        summary: `${name} is now fetched from ${cur.sourceHost} instead of ${base.sourceHost}.`,
        indicators: [`baseline host ${base.sourceHost}`, `current host ${cur.sourceHost}`],
        action: "Confirm with the package's official repository that the move is legitimate before installing.",
        details: { baselineHost: base.sourceHost, currentHost: cur.sourceHost },
      });
    }
  }
  return out;
}

function short(ref: string): string {
  return ref.length > 12 ? ref.slice(0, 12) : ref;
}

export function diffBaseline(current: LockSnapshot, baseline: LockSnapshot): BaselineDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let compared = 0;
  for (const [name, list] of current.packages) {
    const base = baseline.packages.get(name);
    if (!base) {
      added.push(name);
      continue;
    }
    compared++;
    const cur = single(list);
    const b = single(base);
    if (cur && b && (cur.version !== b.version || cur.reference !== b.reference)) changed.push(name);
  }
  for (const name of baseline.packages.keys()) if (!current.packages.has(name)) removed.push(name);
  return { packagesCompared: compared, added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

export function runSupplyChainRules(current: LockSnapshot, baseline: LockSnapshot | null, opts: SupplyChainRuleOptions): Finding[] {
  const queriedAt = opts.now().toISOString();
  const findings: Finding[] = [];
  for (const m of matchesFor(current, baseline, opts)) {
    const decision = decidePriority({ severity: m.severity, exposure: { direct: m.pkg.direct, production: !m.pkg.dev }, fixAvailable: true });
    decision.rationale.unshift(`rule:${m.ruleId}`);
    const subject = `${m.pkg.name}@${m.pkg.version}`;
    findings.push({
      id: `${m.ruleId}::${subject}`,
      kind: "supply-chain-anomaly",
      subject,
      evidence: {
        kind: "supply-chain-anomaly",
        origin: "structural",
        advisoryId: null,
        ruleId: m.ruleId,
        type: m.title,
        summary: sanitize(m.summary, 400),
        indicators: m.indicators.map((i) => sanitize(i, 200)),
        window: null,
        reviewedBy: null,
        reviewedAt: null,
        verification: baseline ? "verified" : "not-applicable",
        details: m.details,
      },
      source: { name: SUPPLY_CHAIN_SOURCE_NAME, queriedAt },
      severity: { tier: m.severity, declared: null, cvss: [] },
      priority: decision.priority,
      rationale: decision.rationale,
      remediation: { fixedVersions: [], action: m.action },
      references: [],
      aiExplanation: null,
    });
  }
  return findings.sort((a, b) => (a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority.localeCompare(b.priority)));
}

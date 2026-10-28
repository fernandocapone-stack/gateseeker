import { describe, expect, it } from "vitest";
import { osvQueryResponseSchema } from "../src/intel/osv-schema.js";
import { buildFinding, extractFixedVersions } from "../src/rules/findings.js";
import {
  BASE_PRIORITY,
  classifyExposure,
  decidePriority,
  priorityAtLeast,
  type ExposureClass,
} from "../src/rules/priority.js";
import type { Dependency, Exposure, Priority, SeverityTier } from "../src/types.js";
import { readJsonFixture } from "./helpers.js";

const EXPOSURES: Record<ExposureClass, Exposure> = {
  "direct-prod": { direct: true, production: true },
  "transitive-prod": { direct: false, production: true },
  "dev-only": { direct: true, production: false },
};

describe("classifyExposure", () => {
  it("maps exposure flags to classes", () => {
    expect(classifyExposure({ direct: true, production: true })).toBe("direct-prod");
    expect(classifyExposure({ direct: false, production: true })).toBe("transitive-prod");
    expect(classifyExposure({ direct: true, production: false })).toBe("dev-only");
    expect(classifyExposure({ direct: false, production: false })).toBe("dev-only");
  });
});

describe("decidePriority: base table (fix available)", () => {
  const tiers: SeverityTier[] = ["CRITICAL", "HIGH", "MODERATE", "LOW", "UNKNOWN"];
  const classes: ExposureClass[] = ["direct-prod", "transitive-prod", "dev-only"];

  // Every cell of the matrix is asserted against an explicit expectation, not
  // against the table itself, so a table edit must be mirrored here on purpose.
  const expected: Record<SeverityTier, Record<ExposureClass, Priority>> = {
    CRITICAL: { "direct-prod": "P1", "transitive-prod": "P1", "dev-only": "P2" },
    HIGH: { "direct-prod": "P1", "transitive-prod": "P2", "dev-only": "P3" },
    MODERATE: { "direct-prod": "P2", "transitive-prod": "P3", "dev-only": "P4" },
    LOW: { "direct-prod": "P3", "transitive-prod": "P4", "dev-only": "P4" },
    UNKNOWN: { "direct-prod": "P2", "transitive-prod": "P3", "dev-only": "P4" },
  };

  for (const tier of tiers) {
    for (const cls of classes) {
      it(`${tier} / ${cls} -> ${expected[tier][cls]}`, () => {
        const d = decidePriority({ severity: tier, exposure: EXPOSURES[cls], fixAvailable: true });
        expect(d.priority).toBe(expected[tier][cls]);
        expect(BASE_PRIORITY[tier][cls]).toBe(expected[tier][cls]);
        expect(d.rationale).toEqual([
          `base:${tier.toLowerCase()}/${cls}=${expected[tier][cls]}`,
          "fix-available",
        ]);
      });
    }
  }

  it("UNKNOWN is never treated more leniently than MODERATE", () => {
    for (const cls of classes) {
      expect(priorityAtLeast(BASE_PRIORITY.UNKNOWN[cls], BASE_PRIORITY.MODERATE[cls])).toBe(true);
    }
  });
});

describe("decidePriority: no-fix modifier", () => {
  it("demotes one level when no fix exists", () => {
    const d = decidePriority({ severity: "MODERATE", exposure: EXPOSURES["direct-prod"], fixAvailable: false });
    expect(d.priority).toBe("P3");
    expect(d.rationale).toEqual(["base:moderate/direct-prod=P2", "no-fix-demote:P2->P3", "no-fix-available"]);
  });

  it("never demotes CRITICAL or HIGH below P2", () => {
    const crit = decidePriority({ severity: "CRITICAL", exposure: EXPOSURES["direct-prod"], fixAvailable: false });
    expect(crit.priority).toBe("P2");
    const high = decidePriority({ severity: "HIGH", exposure: EXPOSURES["transitive-prod"], fixAvailable: false });
    expect(high.priority).toBe("P2");
    expect(high.rationale).toEqual(["base:high/transitive-prod=P2", "no-fix-available"]);
  });

  it("stays at P4 when already P4", () => {
    const d = decidePriority({ severity: "LOW", exposure: EXPOSURES["dev-only"], fixAvailable: false });
    expect(d.priority).toBe("P4");
    expect(d.rationale).toEqual(["base:low/dev-only=P4", "no-fix-available"]);
  });
});

describe("priorityAtLeast", () => {
  it("orders P1 > P2 > P3 > P4", () => {
    expect(priorityAtLeast("P1", "P2")).toBe(true);
    expect(priorityAtLeast("P2", "P2")).toBe(true);
    expect(priorityAtLeast("P3", "P2")).toBe(false);
    expect(priorityAtLeast("P4", "P4")).toBe(true);
  });
});

describe("buildFinding with the real lodash record", () => {
  const response = osvQueryResponseSchema.parse(readJsonFixture("osv/lodash-4.17.20.json"));
  const vuln = response.vulns!.find((v) => v.id === "GHSA-35jh-r3h4-6jhm")!;
  const source = { name: "osv.dev", queriedAt: "2026-10-27T12:00:00.000Z" };
  const direct: Dependency = {
    name: "lodash",
    version: "4.17.20",
    ecosystem: "npm",
    versionStatus: "ok",
    exposure: { direct: true, production: true },
    paths: ["node_modules/lodash"],
  };

  it("extracts fixed versions only for the queried package", () => {
    // The record also lists lodash-es and lodash.template; those must not leak in.
    expect(extractFixedVersions(vuln, direct)).toEqual(["4.17.21"]);
    expect(extractFixedVersions(vuln, { ...direct, name: "not-in-record" })).toEqual([]);
  });

  it("recommends the smallest fixed version above the installed one, by semver", () => {
    const multi = {
      id: "T",
      affected: [
        {
          package: { name: "lodash", ecosystem: "npm" },
          ranges: [
            { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.9.0" }] },
            { type: "SEMVER", events: [{ introduced: "4.10.0" }, { fixed: "4.17.21" }] },
            { type: "SEMVER", events: [{ introduced: "5.0.0" }, { fixed: "5.10.0" }] },
          ],
        },
      ],
    };
    const f = buildFinding(direct, multi, source);
    expect(f.remediation.fixedVersions).toEqual(["4.9.0", "4.17.21", "5.10.0"]);
    expect(f.remediation.action).toBe("Update lodash to 4.17.21 or later in package.json and reinstall.");
  });

  it("names composer.json and composer update for Packagist dependencies", () => {
    const composerDirect: Dependency = { ...direct, name: "guzzlehttp/psr7", version: "1.8.0", ecosystem: "Packagist", paths: ["vendor/guzzlehttp/psr7"] };
    const record = { id: "T", affected: [{ package: { name: "guzzlehttp/psr7", ecosystem: "Packagist" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1.8.4" }] }] }] };
    expect(buildFinding(composerDirect, record, source).remediation.action).toBe("Update guzzlehttp/psr7 to 1.8.4 or later in composer.json and run composer update.");
    const transitive = { ...composerDirect, exposure: { direct: false, production: true } };
    expect(buildFinding(transitive, record, source).remediation.action).toBe("Update the dependency that pulls in guzzlehttp/psr7 so it resolves to 1.8.4 or later (or require it directly at that version).");
  });

  it("produces a P1 finding with evidence and references preserved", () => {
    const f = buildFinding(direct, vuln, source);
    expect(f).toMatchObject({
      id: "GHSA-35jh-r3h4-6jhm::lodash@4.17.20",
      kind: "dependency-vulnerability",
      subject: "lodash@4.17.20",
      priority: "P1",
      rationale: ["base:high/direct-prod=P1", "fix-available"],
      severity: { tier: "HIGH", declared: "HIGH" },
      remediation: {
        fixedVersions: ["4.17.21"],
        action: "Update lodash to 4.17.21 or later in package.json and reinstall.",
      },
      aiExplanation: null,
    });
    expect(f.evidence.kind).toBe("dependency-vulnerability");
    if (f.evidence.kind !== "dependency-vulnerability") return;
    expect(f.evidence.aliases).toEqual(["CVE-2021-23337"]);
    expect(f.evidence.summary).toBe("Command Injection in lodash");
    expect(f.references).toContainEqual({
      type: "ADVISORY",
      url: "https://nvd.nist.gov/vuln/detail/CVE-2021-23337",
    });
    expect(f.references.length).toBe(vuln.references!.length);
  });

  it("lowers priority and changes the action for a transitive dev-only copy", () => {
    const f = buildFinding({ ...direct, exposure: { direct: false, production: false } }, vuln, source);
    expect(f.priority).toBe("P3");
    expect(f.remediation.action).toMatch(/^Update the dependency that pulls in lodash/);
  });

  it("explains the no-fix case", () => {
    const noSev = osvQueryResponseSchema.parse(readJsonFixture("osv/no-severity.json"));
    const dep: Dependency = { ...direct, name: "example-pkg", version: "1.0.0" };
    const f = buildFinding(dep, noSev.vulns![0]!, source);
    expect(f.severity.tier).toBe("UNKNOWN");
    expect(f.remediation.fixedVersions).toEqual([]);
    expect(f.priority).toBe("P3");
    expect(f.rationale).toEqual(["base:unknown/direct-prod=P2", "no-fix-demote:P2->P3", "no-fix-available"]);
    expect(f.remediation.action).toMatch(/No fixed version published for example-pkg@1.0.0/);
  });
});

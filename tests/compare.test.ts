import { beforeAll, describe, expect, it } from "vitest";
import { compareReports, comparisonKey, type ComparedReport } from "../src/report/compare.js";
import { buildFinding } from "../src/rules/findings.js";
import { scanDirectory } from "../src/scan.js";
import type { Dependency, Finding, Report } from "../src/types.js";
import { fixturePath } from "./helpers.js";

/**
 * Comparison between two scans of one repository (docs/SPRINT_6.md test 1):
 * line moves and package upgrades that stay vulnerable are "still open",
 * removals are "fixed" only when the newer scan could have seen them.
 */

let base: Report;
beforeAll(async () => {
  const r = await scanDirectory({ root: fixturePath("projects/vibe-next-supabase"), only: "patterns", now: () => new Date("2026-10-31T12:00:00Z") });
  if (!r.ok) throw new Error("fixture scan failed");
  base = r.report;
});

const source = { name: "osv.dev", queriedAt: "2026-10-31T12:00:00Z" };
const dep = (version: string): Dependency => ({ name: "lodash", version, ecosystem: "npm", versionStatus: "ok", exposure: { direct: true, production: true }, paths: ["node_modules/lodash"] });
const vuln = { id: "GHSA-35jh-r3h4-6jhm", affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }] }] };

function report(findings: Finding[], over: Partial<ComparedReport> = {}): ComparedReport {
  return { findings, analyses: { dependencies: "analyzed", patterns: "analyzed" }, gate: { ...base.gate, verdict: "fail" }, ...over };
}

function pattern(): Finding {
  const f = base.findings.find((x) => x.evidence.kind === "insecure-pattern");
  if (!f) throw new Error("no pattern finding");
  return f;
}

describe("compareReports", () => {
  it("treats the same scan as all still open", () => {
    const c = compareReports(report(base.findings), report(base.findings));
    expect(c.newFindings).toEqual([]);
    expect(c.fixed).toEqual([]);
    expect(c.stillOpen).toHaveLength(base.findings.length);
  });

  it("keeps a code finding that moved to another line as still open", () => {
    const f = pattern();
    if (f.evidence.kind !== "insecure-pattern") return;
    const moved: Finding = { ...f, id: `${f.id}-moved`, subject: `${f.evidence.file}:${String(f.evidence.line + 40)}`, evidence: { ...f.evidence, line: f.evidence.line + 40 } };
    expect(comparisonKey(moved)).toBe(comparisonKey(f));
    const c = compareReports(report([f]), report([moved]));
    expect(c.stillOpen).toEqual([moved]);
  });

  it("keeps a dependency upgraded to another vulnerable version as still open, and marks a real fix as fixed", () => {
    const old = buildFinding(dep("4.17.19"), vuln, source);
    const upgraded = buildFinding(dep("4.17.20"), vuln, source);
    expect(compareReports(report([old]), report([upgraded])).stillOpen).toEqual([upgraded]);
    expect(compareReports(report([old]), report([])).fixed).toEqual([old]);
  });

  it("does not call anything fixed that the newer scan could not check", () => {
    const old = buildFinding(dep("4.17.20"), vuln, source);
    const f = pattern();
    const incomplete = compareReports(report([old, f]), report([], { gate: { ...base.gate, verdict: "incomplete" } }));
    expect(incomplete.fixed).toEqual([f]);
    expect(incomplete.unverified).toEqual([old]);
    const noPatterns = compareReports(report([f]), report([], { analyses: { dependencies: "analyzed", patterns: "not-analyzed" } }));
    expect(noPatterns.fixed).toEqual([]);
    expect(noPatterns.unverified).toEqual([f]);
  });

  it("counts a new finding and matches duplicates one to one", () => {
    const f = pattern();
    const twin: Finding = { ...f, id: `${f.id}-twin` };
    const c = compareReports(report([f]), report([f, twin]));
    expect(c.stillOpen).toHaveLength(1);
    expect(c.newFindings).toEqual([twin]);
  });

  it("never puts snippet text in the key", () => {
    for (const f of base.findings) {
      if (f.evidence.kind !== "insecure-pattern" || f.evidence.snippet.length < 10) continue;
      expect(comparisonKey(f)).not.toContain(f.evidence.snippet);
    }
  });
});

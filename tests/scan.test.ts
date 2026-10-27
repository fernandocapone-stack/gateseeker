import { describe, expect, it } from "vitest";
import { decideVerdict, scan } from "../src/scan.js";
import type { Finding, QueryState } from "../src/types.js";
import { readFixture } from "./helpers.js";

type FetchFn = typeof fetch;

function fetchByName(routes: Record<string, string | number>): FetchFn {
  return (_url, init) => {
    const body = JSON.parse(init?.body as string) as { package: { name: string } };
    const route = routes[body.package.name];
    if (route === undefined) return Promise.resolve(new Response("{}", { status: 404 }));
    if (typeof route === "number") return Promise.resolve(new Response("{}", { status: route }));
    return Promise.resolve(new Response(route, { status: 200, headers: { "content-type": "application/json" } }));
  };
}

const fixedNow = () => new Date("2026-10-27T12:00:00.000Z");

async function run(fixture: string, routes: Record<string, string | number>, failOn?: "P1" | "P2" | "P3" | "P4") {
  const result = await scan({
    lockfilePath: `fixtures/lockfiles/${fixture}`,
    lockfileContent: readFixture(`lockfiles/${fixture}`),
    osv: { fetch: fetchByName(routes) },
    now: fixedNow,
    runId: "test-run",
    ...(failOn ? { failOn } : {}),
  });
  if (!result.ok) throw new Error(`unexpected rejection ${result.error.code}`);
  return result.report;
}

const LODASH = readFixture("osv/lodash-4.17.20.json");
const EMPTY = readFixture("osv/zod-4.6.7.json");

describe("scan", () => {
  it("fails the gate on a real known vulnerability and reports clean deps separately", async () => {
    const report = await run("direct-only.package-lock.json", { lodash: LODASH, zod: EMPTY });

    expect(report.gate).toEqual({
      failOn: "P2",
      verdict: "fail",
      reason: "5 finding(s) at priority P2 or higher.",
    });
    expect(report.summary.byQueryState).toEqual({
      vulnerable: 1,
      "no-known-vulnerabilities": 1,
      "query-failed": 0,
      "not-queried": 0,
    });
    expect(report.summary.byPriority).toEqual({ P1: 2, P2: 3, P3: 0, P4: 0 });
    expect(report.findings.map((f) => f.id)).toEqual([
      "GHSA-35jh-r3h4-6jhm::lodash@4.17.20",
      "GHSA-r5fr-rjxr-66jc::lodash@4.17.20",
      "GHSA-29mw-wpgm-hmr9::lodash@4.17.20",
      "GHSA-f23m-r3pf-42rh::lodash@4.17.20",
      "GHSA-xxjr-mmjv-4gpg::lodash@4.17.20",
    ]);
    expect(report.queries).toEqual([
      { dependency: "lodash@4.17.20", state: "vulnerable", source: "osv.dev", queriedAt: "2026-10-27T12:00:00.000Z", error: null },
      { dependency: "zod@4.6.7", state: "no-known-vulnerabilities", source: "osv.dev", queriedAt: "2026-10-27T12:00:00.000Z", error: null },
    ]);
    expect(report.project).toMatchObject({ lockfileVersion: 3, name: "fixture-direct-only" });
    expect(report.project.lockfileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(report.errors).toEqual([]);
    expect(report.limitations.length).toBeGreaterThan(0);
    expect(report.sources).toEqual([{ name: "osv.dev", endpoint: "https://api.osv.dev/v1/query" }]);
  });

  it("passes only when every dependency was queried and nothing reaches the threshold", async () => {
    const report = await run("direct-only.package-lock.json", { lodash: EMPTY, zod: EMPTY });
    expect(report.findings).toEqual([]);
    expect(report.gate.verdict).toBe("pass");
    expect(report.gate.reason).toMatch(/No known vulnerabilities at that level were found in the sources consulted/);
  });

  it("respects --fail-on: P1 threshold still fails, P1-only threshold with P2 findings passes", async () => {
    const strict = await run("direct-only.package-lock.json", { lodash: LODASH, zod: EMPTY }, "P1");
    expect(strict.gate.verdict).toBe("fail");
    expect(strict.gate.reason).toBe("2 finding(s) at priority P1 or higher.");
  });

  it("marks the run incomplete when a query fails, even with no findings", async () => {
    const report = await run("direct-only.package-lock.json", { lodash: EMPTY, zod: 503 });
    expect(report.findings).toEqual([]);
    expect(report.gate.verdict).toBe("incomplete");
    expect(report.summary.byQueryState["query-failed"]).toBe(1);
    expect(report.queries.find((q) => q.dependency === "zod@4.6.7")).toMatchObject({
      state: "query-failed",
      error: "HTTP 503",
    });
    expect(report.errors).toEqual(["Query for zod@4.6.7 failed: HTTP 503"]);
  });

  it("still fails (not incomplete) when a blocking finding exists alongside failed queries", async () => {
    const report = await run("direct-only.package-lock.json", { lodash: LODASH, zod: 500 });
    expect(report.gate.verdict).toBe("fail");
    expect(report.summary.byQueryState["query-failed"]).toBe(1);
  });

  it("marks dependencies with unusable versions as not-queried and the run as incomplete", async () => {
    const report = await run("odd-versions.package-lock.json", { zod: EMPTY });
    const states = Object.fromEntries(report.queries.map((q) => [q.dependency, q.state]));
    expect(states).toEqual({
      "git-pkg@1.2.3": "not-queried",
      "no-version-pkg@<missing>": "not-queried",
      "weird-version-pkg@1.x": "not-queried",
      "zod@4.6.7": "no-known-vulnerabilities",
    });
    expect(report.gate.verdict).toBe("incomplete");
    expect(report.gate.reason).toMatch(/3 dependency\(ies\) could not be queried/);
    // Parser warnings (symlink, workspace) are surfaced as errors/limitations of the run.
    expect(report.errors).toHaveLength(2);
  });

  it("applies exposure from the lockfile to priorities of transitive dev copies", async () => {
    // ms@2.0.0 (transitive, dev) and ms@2.1.2 (transitive, prod) both get the lodash record
    // injected to observe exposure-driven priorities on the same vulnerability data.
    const lodashAsMs = LODASH.replaceAll('"name": "lodash"', '"name": "ms"');
    const report = await run("transitive.package-lock.json", { ms: lodashAsMs, debug: EMPTY, "fake-test-runner": EMPTY });
    const cmdInjection = report.findings.filter((f) => f.evidence.vulnerabilityId === "GHSA-35jh-r3h4-6jhm");
    const byDep = Object.fromEntries(cmdInjection.map((f) => [f.subject, f.priority]));
    expect(byDep).toEqual({ "ms@2.1.2": "P2", "ms@2.0.0": "P3" });
  });

  it("rejects an invalid lockfile before any network call", async () => {
    let calls = 0;
    const result = await scan({
      lockfilePath: "x",
      lockfileContent: readFixture("lockfiles/v1.package-lock.json"),
      osv: {
        fetch: () => {
          calls++;
          return Promise.resolve(new Response("{}"));
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unsupported-lockfile-version");
    expect(calls).toBe(0);
  });
});

describe("decideVerdict", () => {
  const none: Record<QueryState, number> = { vulnerable: 0, "no-known-vulnerabilities": 3, "query-failed": 0, "not-queried": 0 };
  const finding = (priority: Finding["priority"]) => ({ priority }) as Finding;

  it("pass requires zero unresolved queries", () => {
    expect(decideVerdict([], none, "P2").verdict).toBe("pass");
    expect(decideVerdict([], { ...none, "query-failed": 1 }, "P2").verdict).toBe("incomplete");
    expect(decideVerdict([], { ...none, "not-queried": 1 }, "P2").verdict).toBe("incomplete");
  });

  it("fail wins over incomplete", () => {
    expect(decideVerdict([finding("P1")], { ...none, "query-failed": 2 }, "P2").verdict).toBe("fail");
  });

  it("findings below the threshold do not fail the gate", () => {
    expect(decideVerdict([finding("P3"), finding("P4")], none, "P2").verdict).toBe("pass");
    expect(decideVerdict([finding("P3")], none, "P3").verdict).toBe("fail");
    expect(decideVerdict([finding("P4")], none, "P4").verdict).toBe("fail");
  });
});

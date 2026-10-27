import { createServer, type Server } from "node:http";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { EXIT, main } from "../src/cli.js";
import { advisoryTagMatch, buildAdvisoryFinding } from "../src/intel/advisories.js";
import type { Advisory } from "../src/intel/advisory-schema.js";
import { PackagistClient, expandMinified } from "../src/intel/packagist.js";
import { parseComposerLock } from "../src/parser/composer.js";
import { parseLockfile } from "../src/parser/lockfile.js";
import { scan, scanDirectory } from "../src/scan.js";
import { snapshotFromComposer, snapshotFromNpm } from "../src/supplychain/snapshot.js";
import { diffBaseline, runSupplyChainRules } from "../src/supplychain/rules.js";
import type { Dependency, Finding } from "../src/types.js";
import { fixturePath, readFixture, readJsonFixture } from "./helpers.js";

const P2 = readFixture("packagist/laravel-lang-lang.p2.json");
const LARAVEL_ADVISORY = readJsonFixture("../advisories/approved/2026-05-22-laravel-lang-tag-rewrite.json") as Advisory;
const fixedNow = () => new Date("2026-10-27T12:00:00.000Z");

function packagistFetch(routes: Record<string, string | number>): typeof fetch {
  return (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const name = url.replace(/^.*\/p2\//, "").replace(/\.json$/, "");
    const r = routes[name];
    if (r === undefined) return Promise.resolve(new Response("{}", { status: 404 }));
    if (typeof r === "number") return Promise.resolve(new Response("", { status: r }));
    return Promise.resolve(new Response(r, { status: 200, headers: { "content-type": "application/json" } }));
  };
}

const emptyOsv: typeof fetch = () => Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

describe("Packagist p2 client", () => {
  it("expands the delta-encoded (minified) version list", () => {
    const out = expandMinified([{ version: "2.0.0", source: { reference: "b" }, time: "t2", license: ["MIT"] }, { version: "1.0.0", source: { reference: "a" }, time: "t1" }, { version: "0.9.0", license: "__unset" }]);
    expect(out[1]).toEqual({ version: "1.0.0", source: { reference: "a" }, time: "t1", license: ["MIT"] });
    expect(out[2]).toEqual({ version: "0.9.0", source: { reference: "a" }, time: "t1" });
  });

  it("reads the recorded real metadata and resolves a version to its current commit", async () => {
    const client = new PackagistClient({ fetch: packagistFetch({ "laravel-lang/lang": P2 }), now: fixedNow });
    const r = await client.versions("laravel-lang/lang");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.versions.map((v) => v.version)).toEqual(["15.37.4", "15.37.3", "15.37.2", "15.37.1", "15.37.0", "15.36.1"]);
    expect(r.versions[0]?.reference).toBe("a3a9ef9b039d10db442bfb3bed0a97c9b50f30a7");
    expect(r.versions[2]?.reference).toBe("40c4749c96709e1d2da12860d4f6c249b2d52e43"); // from a delta entry
    expect(await client.currentReference("laravel-lang/lang", "v15.37.2")).toMatchObject({ status: "ok", reference: "40c4749c96709e1d2da12860d4f6c249b2d52e43" });
    expect(await client.currentReference("laravel-lang/lang", "1.0.0")).toEqual({ status: "not-found" });
  });

  it("reports unknown packages, HTTP errors, bad schemas and invalid names", async () => {
    const client = new PackagistClient({ fetch: packagistFetch({ "acme/broken": "[]", "acme/down": 503 }) });
    expect((await client.versions("acme/missing")).status).toBe("not-found");
    expect(await client.versions("acme/down")).toMatchObject({ status: "failed", error: "HTTP 503" });
    expect(await client.versions("acme/broken")).toMatchObject({ status: "failed", error: expect.stringMatching(/schema/) as string });
    expect(await client.versions("Not A Name")).toMatchObject({ status: "failed", error: expect.stringMatching(/not a valid/) as string });
  });
});

describe("advisory tag match (Laravel-Lang record)", () => {
  const base: Dependency = {
    name: "laravel-lang/lang",
    version: "15.37.2",
    ecosystem: "Packagist",
    versionStatus: "ok",
    exposure: { direct: true, production: true },
    paths: ["packages/laravel-lang/lang"],
    sourceReference: "40c4749c96709e1d2da12860d4f6c249b2d52e43",
    sourceUrl: "https://github.com/Laravel-Lang/lang.git",
    releasedAt: "2026-09-30T11:01:30+00:00",
  };
  const registry = new PackagistClient({ fetch: packagistFetch({ "laravel-lang/lang": P2 }) });

  it("does not match a lock whose commit equals the registry's and whose release predates or postdates the window", async () => {
    const r = await advisoryTagMatch(LARAVEL_ADVISORY, base, registry);
    expect(r).toMatchObject({ matched: false, verification: "verified", lookupError: null });
    expect(r.details["referenceMismatch"]).toBe(false);
    expect(r.details["registryInWindow"]).toBe(false);
  });

  it("matches (verified) when the registry still serves a commit dated inside the rewrite window", async () => {
    const poisoned = JSON.stringify({ packages: { "laravel-lang/lang": [{ version: "15.22.7", source: { reference: "deadbeef" }, time: "2026-05-22T22:40:00+00:00" }] }, minified: "composer/2.0" });
    const reg = new PackagistClient({ fetch: packagistFetch({ "laravel-lang/lang": poisoned }) });
    const r = await advisoryTagMatch(LARAVEL_ADVISORY, { ...base, version: "15.22.7", sourceReference: "deadbeef", releasedAt: "2026-05-22T22:40:00+00:00" }, reg);
    expect(r).toMatchObject({ matched: true, verification: "verified" });
    expect(r.details).toMatchObject({ referenceMismatch: false, registryInWindow: true, lockInWindow: true });
  });

  it("matches (verified) when the lock pins a different commit for the same version", async () => {
    const r = await advisoryTagMatch(LARAVEL_ADVISORY, { ...base, sourceReference: "40c4749c96709e1d2da12860d4f6c249b2d52e43bad" }, registry);
    expect(r).toMatchObject({ matched: true, verification: "verified" });
    expect(r.details["referenceMismatch"]).toBe(true);
  });

  it("matches by time inside the window and marks it unverified when the registry is unavailable", async () => {
    const inWindow = { ...base, releasedAt: "2026-05-22T23:00:00Z", sourceReference: "deadbeef" };
    const down = new PackagistClient({ fetch: packagistFetch({ "laravel-lang/lang": 503 }) });
    const r = await advisoryTagMatch(LARAVEL_ADVISORY, inWindow, down);
    expect(r).toMatchObject({ matched: true, verification: "unverified", lookupError: "HTTP 503" });
    const noRegistry = await advisoryTagMatch(LARAVEL_ADVISORY, inWindow, null);
    expect(noRegistry).toMatchObject({ matched: true, verification: "unverified", lookupError: "registry lookup disabled" });
    const before = await advisoryTagMatch(LARAVEL_ADVISORY, { ...base, releasedAt: "2026-05-01T00:00:00Z", sourceReference: "deadbeef" }, down);
    expect(before).toMatchObject({ matched: false, verification: "unverified" });
  });

  it("ignores packages and ecosystems the record does not cover", async () => {
    expect((await advisoryTagMatch(LARAVEL_ADVISORY, { ...base, name: "laravel/framework" }, registry)).verification).toBe("not-applicable");
    expect((await advisoryTagMatch(LARAVEL_ADVISORY, { ...base, ecosystem: "npm" }, registry)).verification).toBe("not-applicable");
  });

  it("builds a P1 finding carrying the comparison details and the unverified caveat", async () => {
    const r = await advisoryTagMatch(LARAVEL_ADVISORY, { ...base, releasedAt: "2026-05-22T23:00:00Z" }, null);
    const f = buildAdvisoryFinding(base, LARAVEL_ADVISORY, "2026-10-27T12:00:00.000Z", r);
    expect(f.priority).toBe("P2"); // CRITICAL, direct-prod, no fix published -> demoted to P2 by the no-fix rule
    expect(f.rationale).toEqual(["advisory:GSK-ADV-2026-0001", "base:critical/direct-prod=P1", "no-fix-demote:P1->P2", "no-fix-available"]);
    expect(f.evidence.kind === "supply-chain-anomaly" && f.evidence.verification).toBe("unverified");
    expect(f.remediation.action).toMatch(/verify the pinned commit manually/);
  });
});

describe("structural supply-chain rules", () => {
  function composerSnap(rel: string, manifest: string | null = null) {
    const content = readFixture(rel);
    const p = parseComposerLock(content, manifest);
    if (!p.ok) throw new Error(p.error.message);
    return snapshotFromComposer(p.lockfile, rel, content);
  }
  const opts = { now: fixedNow, maxReleaseAgeDays: 3 };
  const ids = (f: Finding[]) => f.map((x) => `${x.evidence.kind === "supply-chain-anomaly" ? x.evidence.ruleId : "?"} ${x.subject} ${x.priority}`).sort();

  it("reproduces the Laravel-Lang pattern between two locks: same version, new commit, new autoload file", () => {
    const current = composerSnap("composer/laravel-lang-case/after.composer.lock");
    const baseline = composerSnap("composer/laravel-lang-case/before.composer.lock");
    const findings = runSupplyChainRules(current, baseline, opts);
    expect(ids(findings)).toEqual([
      "GSK-SC-002 laravel-lang/attributes@2.13.5 P2",
      "GSK-SC-002 laravel-lang/lang@15.22.7 P2",
      "GSK-SC-003 laravel-lang/attributes@2.13.5 P1",
      "GSK-SC-003 laravel-lang/lang@15.22.7 P1",
    ]);
    const sc3 = findings.find((f) => f.id === "GSK-SC-003::laravel-lang/lang@15.22.7");
    expect(sc3?.evidence.kind === "supply-chain-anomaly" ? sc3.evidence.details : null).toMatchObject({ baselineReference: "bbbb000000000000000000000000000000000001", currentReference: "bbbb00000000000000000000000000000000bad1" });
    expect(diffBaseline(current, baseline)).toEqual({ packagesCompared: 3, added: [], removed: [], changed: ["laravel-lang/attributes", "laravel-lang/lang"] });
  });

  it("stays silent on an ordinary update and ignores new packages' autoload files", () => {
    const current = composerSnap("composer/normal-update/after.composer.lock");
    const baseline = composerSnap("composer/normal-update/before.composer.lock");
    expect(runSupplyChainRules(current, baseline, opts)).toEqual([]);
    expect(diffBaseline(current, baseline)).toEqual({ packagesCompared: 1, added: ["acme/added-now"], removed: ["acme/removed-later"], changed: ["monolog/monolog"] });
  });

  it("flags commit-pinned production dependencies and very recent releases without a baseline", () => {
    const current = composerSnap("composer/basic/composer.lock", readFixture("composer/basic/composer.json"));
    const recent = runSupplyChainRules(current, null, { now: () => new Date("2026-10-02T00:00:00Z"), maxReleaseAgeDays: 3 });
    expect(ids(recent)).toEqual(["GSK-SC-001 acme/bleeding-edge@dev-main P3", "GSK-SC-004 acme/bleeding-edge@dev-main P4"]);
    const later = runSupplyChainRules(current, null, opts);
    expect(ids(later)).toEqual(["GSK-SC-001 acme/bleeding-edge@dev-main P3"]);
    expect(runSupplyChainRules(current, null, { now: fixedNow, maxReleaseAgeDays: 0 }).length).toBe(1);
  });

  it("detects a changed integrity for the same npm version and a git-pinned npm dependency", () => {
    const base = readFixture("lockfiles/direct-only.package-lock.json");
    const cur = base.replace("sha512-PlhdFcillOINfeV7Ni6oF1TAEayyZBoZ8bcshTHqOYJYlrqzRK5hagpagky5o4HfCzzd1TRkXPMFq6cKk9rGmA==", "sha512-tampered000000000000000000000000000000000000000000000000000000000000000000000000000==");
    const pb = parseLockfile(base);
    const pc = parseLockfile(cur);
    if (!pb.ok || !pc.ok) throw new Error("fixture");
    const findings = runSupplyChainRules(snapshotFromNpm(pc.lockfile, "cur", cur), snapshotFromNpm(pb.lockfile, "base", base), opts);
    expect(ids(findings)).toEqual(["GSK-SC-003 lodash@4.17.20 P1"]);

    const odd = parseLockfile(readFixture("lockfiles/odd-versions.package-lock.json"));
    if (!odd.ok) throw new Error("fixture");
    const pinned = runSupplyChainRules(snapshotFromNpm(odd.lockfile, "odd", ""), null, opts);
    expect(ids(pinned)).toEqual(["GSK-SC-001 git-pkg@1.2.3 P2"]);
  });
});

describe("scan with composer.lock", () => {
  const osvFetch: typeof fetch = (_u, init) => {
    const body = JSON.parse(init?.body as string) as { package: { name: string; ecosystem: string } };
    const text = body.package.name === "laravel/framework" ? readFixture("osv/laravel-framework-10.0.0.json") : "{}";
    return Promise.resolve(new Response(text, { status: 200, headers: { "content-type": "application/json" } }));
  };
  const advisories = { advisories: [LARAVEL_ADVISORY], origin: "test", digest: "0000000000000000", problems: [] };

  it("queries OSV for Packagist, matches the Laravel-Lang record by tag rewrite, and runs the structural rules with a baseline", async () => {
    const r = await scan({
      lockfilePath: fixturePath("composer/laravel-lang-case/after.composer.lock"),
      lockfileContent: readFixture("composer/laravel-lang-case/after.composer.lock"),
      baseline: { path: fixturePath("composer/laravel-lang-case/before.composer.lock"), content: readFixture("composer/laravel-lang-case/before.composer.lock") },
      osv: { fetch: osvFetch },
      packagist: { fetch: packagistFetch({ "laravel-lang/lang": P2, "laravel-lang/attributes": 404 }) },
      advisories,
      now: fixedNow,
      runId: "t",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rep = r.report;
    expect(rep.project.lockfiles.map((l) => l.kind)).toEqual(["composer.lock"]);
    expect(rep.baseline).toMatchObject({ packagesCompared: 3, changed: ["laravel-lang/attributes", "laravel-lang/lang"] });
    const adv = rep.findings.filter((f) => f.evidence.kind === "supply-chain-anomaly" && f.evidence.origin === "advisory");
    // lang@15.22.7: registry (p2 fixture) does not list that version -> unverified, matched by time in window.
    // attributes@2.13.5: Packagist 404 -> unverified, matched by time in window.
    expect(adv.map((f) => `${f.subject} ${f.priority} ${f.evidence.kind === "supply-chain-anomaly" ? f.evidence.verification : ""}`).sort()).toEqual([
      "laravel-lang/attributes@2.13.5 P2 unverified",
      "laravel-lang/lang@15.22.7 P2 unverified",
    ]);
    expect(rep.summary.byKind["supply-chain-anomaly"]).toBe(6); // 2 advisory + 2x SC-002 + 2x SC-003
    expect(rep.queries.filter((q) => q.source === "packagist.org").map((q) => `${q.dependency}:${q.state}`)).toEqual(["laravel-lang/attributes@2.13.5:query-failed", "laravel-lang/lang@15.22.7:query-failed"]);
    // Curated advisory matches gate; structural rules are warn by default; failed Packagist lookups would make it incomplete, but fail wins.
    expect(rep.gate).toMatchObject({ verdict: "fail", supplyChainMode: "warn" });
    expect(rep.sources.map((s) => s.name)).toEqual(["osv.dev", "gateseeker-advisories", "packagist.org", "gateseeker-supply-chain-rules"]);
  });

  it("passes a clean pre-attack lock when the registry confirms the commits (verified)", async () => {
    const before = readFixture("composer/laravel-lang-case/before.composer.lock");
    // Serve a p2 whose 15.22.7 entry carries exactly the lock's commit.
    const p2 = JSON.stringify({ packages: { "laravel-lang/lang": [{ version: "15.22.7", version_normalized: "15.22.7.0", source: { type: "git", url: "https://github.com/Laravel-Lang/lang.git", reference: "bbbb000000000000000000000000000000000001" }, time: "2025-08-08T00:17:56+00:00" }] }, minified: "composer/2.0" });
    const p2attr = JSON.stringify({ packages: { "laravel-lang/attributes": [{ version: "2.13.5", source: { reference: "aaaa000000000000000000000000000000000001" }, time: "2025-06-23T09:39:20+00:00" }] }, minified: "composer/2.0" });
    const r = await scan({ lockfilePath: fixturePath("composer/laravel-lang-case/before.composer.lock"), lockfileContent: before, osv: { fetch: emptyOsv }, packagist: { fetch: packagistFetch({ "laravel-lang/lang": p2, "laravel-lang/attributes": p2attr }) }, advisories, now: fixedNow });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.findings).toEqual([]);
    expect(r.report.queries.filter((q) => q.source === "packagist.org").every((q) => q.state === "no-known-vulnerabilities")).toBe(true);
    expect(r.report.gate.verdict).toBe("pass");
  });

  it("with --no-packagist the window match is unverified and the lookup is declared not-queried (incomplete when nothing fails)", async () => {
    const r = await scan({ lockfilePath: fixturePath("composer/laravel-lang-case/before.composer.lock"), lockfileContent: readFixture("composer/laravel-lang-case/before.composer.lock"), osv: { fetch: emptyOsv }, packagist: false, advisories, now: fixedNow });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.findings).toEqual([]); // pre-attack lock: not in window
    expect(r.report.gate.verdict).toBe("incomplete");
    expect(r.report.limitations.join("\n")).toMatch(/Packagist lookups were disabled/);
  });

  it("reports OSV vulnerabilities for a Composer package (real recorded response)", async () => {
    const lock = JSON.stringify({ packages: [{ name: "laravel/framework", version: "v10.0.0", dist: { type: "zip", url: "https://api.github.com/repos/laravel/framework/zipball/x" }, source: { type: "git", url: "https://github.com/laravel/framework.git", reference: "x" } }], "packages-dev": [] });
    const r = await scan({ lockfilePath: "composer.lock", lockfileContent: lock, osv: { fetch: osvFetch }, packagist: false, advisories: { advisories: [], origin: "test", digest: "0", problems: [] }, now: fixedNow });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.summary.byKind["dependency-vulnerability"]).toBe(6);
    expect(r.report.findings.every((f) => f.subject === "laravel/framework@10.0.0")).toBe(true);
    expect(r.report.gate.verdict).toBe("fail");
  });

  it("rejects a baseline of another lockfile kind", async () => {
    const r = await scan({ lockfilePath: fixturePath("composer/basic/composer.lock"), lockfileContent: readFixture("composer/basic/composer.lock"), baseline: { path: "package-lock.json", content: "{}" }, osv: { fetch: emptyOsv }, packagist: false, advisories: { advisories: [], origin: "test", digest: "0", problems: [] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("baseline-mismatch");
  });

  it("scanDirectory picks up composer.lock next to package-lock.json", async () => {
    const r = await scanDirectory({ root: fixturePath("composer/basic"), only: "deps", osv: { fetch: emptyOsv }, packagist: false, advisories: { advisories: [], origin: "test", digest: "0", problems: [] }, now: fixedNow });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.project.lockfiles.map((l) => l.kind)).toEqual(["composer.lock"]);
    expect(r.report.project.name).toBe("gateseeker/fixture-basic");
    expect(r.report.dependencies.length).toBe(6);
  });
});

describe("CLI: composer.lock and --baseline", () => {
  let server: Server;
  let endpoint: string;
  let p2base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c: Buffer) => (data += c.toString()));
      req.on("end", () => {
        if (req.url?.startsWith("/p2/")) {
          const name = req.url.replace("/p2/", "").replace(/\.json$/, "");
          if (name === "laravel-lang/lang") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(P2);
          } else {
            res.writeHead(404);
            res.end("{}");
          }
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (addr === null || typeof addr === "string") throw new Error("no address");
    endpoint = `http://127.0.0.1:${addr.port}/v1/query`;
    p2base = `http://127.0.0.1:${addr.port}/p2/`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((e) => {
        if (e) reject(e);
        else resolve();
      });
    });
  });
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return { io: { stdout: (s: string) => { out.push(s); }, stderr: (s: string) => { err.push(s); } }, stdout: () => out.join(""), stderr: () => err.join("") };
  }

  it("prints structural and advisory findings for the Laravel-Lang case with a baseline", async () => {
    const c = capture();
    const code = await main(
      ["scan", fixturePath("composer/laravel-lang-case/after.composer.lock"), "--baseline", fixturePath("composer/laravel-lang-case/before.composer.lock"), "--osv-endpoint", endpoint, "--packagist-base", p2base, "--advisories", fixturePath("../advisories/approved/2026-05-22-laravel-lang-tag-rewrite.json")],
      c.io,
    );
    expect(code).toBe(EXIT.fail);
    const text = c.stdout();
    expect(text).toContain("baseline");
    expect(text).toContain("GSK-SC-003  supply-chain: Same version now resolves to different content");
    expect(text).toContain("GSK-ADV-2026-0001  supply-chain: tag-rewrite");
    expect(text).toContain("GATE: FAIL (fail-on P2, patterns warn, supply-chain rules warn)");
  });

  it("rejects a mismatched or unreadable baseline with exit 3", async () => {
    const a = capture();
    expect(await main(["scan", fixturePath("composer/basic/composer.lock"), "--baseline", fixturePath("lockfiles/direct-only.package-lock.json"), "--no-packagist", "--osv-endpoint", endpoint], a.io)).toBe(EXIT.usage);
    expect(a.stderr()).toContain("baseline-mismatch");
    const b = capture();
    expect(await main(["scan", fixturePath("composer/basic/composer.lock"), "--baseline", fixturePath("composer/missing.lock")], b.io)).toBe(EXIT.usage);
    expect(b.stderr()).toContain("Cannot read --baseline");
    const d = capture();
    expect(await main(["scan", fixturePath("composer/basic/composer.lock"), "--max-release-age-days", "-1"], d.io)).toBe(EXIT.usage);
  });
});

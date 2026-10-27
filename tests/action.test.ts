import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAction, type ActionIo } from "../src/action/run.js";
import { upsertStickyComment } from "../src/action/github.js";
import { EXIT, main } from "../src/cli.js";
import { levelFor, renderSarif } from "../src/report/sarif.js";
import { SUMMARY_MARKER, renderSummary } from "../src/report/summary.js";
import { scan, scanDirectory } from "../src/scan.js";
import type { Report } from "../src/types.js";
import { fixturePath, readFixture } from "./helpers.js";

const fixedNow = () => new Date("2026-10-27T12:00:00.000Z");
const LODASH = readFixture("osv/lodash-4.17.20.json");
const osvFetch: typeof fetch = (_u, init) => {
  const body = JSON.parse(init?.body as string) as { package: { name: string } };
  return Promise.resolve(new Response(body.package.name === "lodash" ? LODASH : "{}", { status: 200, headers: { "content-type": "application/json" } }));
};
const noAdvisories = { advisories: [], origin: "test", digest: "0000000000000000", problems: [] };

async function vibeReport(): Promise<Report> {
  const r = await scanDirectory({ root: fixturePath("projects/vibe-next-supabase"), osv: { fetch: osvFetch }, packagist: false, advisories: noAdvisories, now: fixedNow, runId: "sarif-test" });
  if (!r.ok) throw new Error(r.error.message);
  return r.report;
}

describe("SARIF renderer", () => {
  it("emits one result per finding with stable fingerprints, levels by priority and locations", async () => {
    const report = await vibeReport();
    const sarif = renderSarif(report);
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0]!;
    expect(run.tool.driver.name).toBe("Gateseeker");
    expect(run.results.length).toBe(report.findings.length);
    expect(run.results.length).toBeGreaterThan(15);
    // rules are unique
    const ids = run.tool.driver.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("GSK-SECRET-001");
    expect(ids).toContain("GHSA-35jh-r3h4-6jhm");
    // a pattern result points at file:line
    const secret = run.results.find((r) => r.ruleId === "GSK-SECRET-001" && r.properties.subject === "lib/stripe.ts:4")!;
    expect(secret.level).toBe("error");
    expect(secret.locations[0]?.physicalLocation.artifactLocation.uri).toBe("lib/stripe.ts");
    expect(secret.locations[0]?.physicalLocation.region).toEqual({ startLine: 4 });
    expect(secret.message.text).toContain("Revoke the credential");
    expect(secret.message.text).not.toMatch(/sk_live_[A-Za-z0-9]{10}/);
    // a dependency result points at the lockfile
    const dep = run.results.find((r) => r.ruleId === "GHSA-35jh-r3h4-6jhm")!;
    expect(dep.locations[0]?.physicalLocation.artifactLocation.uri).toBe("package-lock.json");
    // fingerprints stable across renders
    const again = renderSarif(report);
    expect(again.runs[0]!.results.map((r) => r.partialFingerprints)).toEqual(run.results.map((r) => r.partialFingerprints));
    expect(run.invocations[0]?.properties.verdict).toBe("fail");
  });

  it("maps priorities to SARIF levels", () => {
    expect(levelFor("P1")).toBe("error");
    expect(levelFor("P2")).toBe("error");
    expect(levelFor("P3")).toBe("warning");
    expect(levelFor("P4")).toBe("note");
  });
});

describe("summary renderer", () => {
  it("renders the marker, counts, a capped table and the product wording", async () => {
    const report = await vibeReport();
    const md = renderSummary(report);
    expect(md.startsWith(SUMMARY_MARKER)).toBe(true);
    expect(md).toContain("### ❌ Gateseeker: FAIL");
    expect(md).toContain(`| Findings | ${report.summary.byPriority.P1} | ${report.summary.byPriority.P2} |`);
    expect(md).toContain(`… and ${report.findings.length - 20} more in the JSON report.`);
    // The product wording: no "secure"/"safe" outside the limitations block, which quotes the caveat itself.
    const withoutLimitations = md.replace(/<details><summary>Limitations<\/summary>[\s\S]*?<\/details>/, "");
    expect(withoutLimitations).not.toMatch(/\b(secure|safe)\b/i);
    expect(md).toContain("<details><summary>Limitations</summary>");
    // Markdown from untrusted strings is escaped: no raw pipes inside cells.
    const rows = md.split("\n").filter((l) => l.startsWith("| P"));
    for (const row of rows) expect(row.split("|").length).toBe(7);
  });

  it("says pass with the cautious wording on a clean project", async () => {
    const r = await scanDirectory({ root: fixturePath("projects/clean-vite"), now: fixedNow, advisories: noAdvisories, packagist: false });
    if (!r.ok) throw new Error("fixture");
    const md = renderSummary(r.report);
    expect(md).toContain("### ✅ Gateseeker: PASS");
    expect(md).toContain("No known vulnerabilities or insecure patterns were found in the sources consulted.");
    expect(md).toContain("Dependencies were not analyzed");
  });
});

describe("CLI formats sarif and summary", () => {
  it("prints SARIF and summary while still writing the JSON report with --output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gateseeker-fmt-"));
    try {
      const out: string[] = [];
      const io = { stdout: (s: string) => void out.push(s), stderr: () => undefined };
      const code = await main(["scan", fixturePath("projects/clean-vite"), "--only", "patterns", "--format", "sarif", "--output", join(dir, "r.json")], io);
      expect(code).toBe(EXIT.pass);
      const sarif = JSON.parse(out.join("")) as { version: string; runs: unknown[] };
      expect(sarif.version).toBe("2.1.0");
      const json = JSON.parse(await readFile(join(dir, "r.json"), "utf8")) as Report;
      expect(json.gate.verdict).toBe("pass");
      out.length = 0;
      expect(await main(["scan", fixturePath("projects/clean-vite"), "--only", "patterns", "--format", "summary"], io)).toBe(EXIT.pass);
      expect(out.join("")).toContain(SUMMARY_MARKER);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Action runner", () => {
  let server: Server;
  let apiUrl: string;
  const comments: { id: number; body: string }[] = [];
  let failList = false;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c: Buffer) => (data += c.toString()));
      req.on("end", () => {
        const url = req.url ?? "";
        if (url.startsWith("/v1/query")) {
          const body = JSON.parse(data) as { package: { name: string } };
          res.writeHead(200, { "content-type": "application/json" });
          res.end(body.package.name === "lodash" ? LODASH : "{}");
          return;
        }
        if (req.method === "GET" && /\/issues\/\d+\/comments/.test(url)) {
          if (failList) {
            res.writeHead(403);
            res.end("{\"message\":\"Resource not accessible by integration\"}");
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(comments));
          return;
        }
        if (req.method === "POST" && /\/issues\/\d+\/comments/.test(url)) {
          const c = { id: comments.length + 1, body: (JSON.parse(data) as { body: string }).body };
          comments.push(c);
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify(c));
          return;
        }
        if (req.method === "PATCH" && /\/issues\/comments\/\d+/.test(url)) {
          const id = Number(url.split("/").pop());
          const c = comments.find((x) => x.id === id)!;
          c.body = (JSON.parse(data) as { body: string }).body;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(c));
          return;
        }
        res.writeHead(404);
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => {
      server.close(() => {
        r();
      });
    });
  });

  async function setup(extraEnv: Record<string, string> = {}, pr = true) {
    const dir = await mkdtemp(join(tmpdir(), "gateseeker-action-"));
    const eventPath = join(dir, "event.json");
    await writeFile(eventPath, JSON.stringify(pr ? { pull_request: { number: 7 } } : { ref: "refs/heads/main" }));
    const env: Record<string, string> = {
      GITHUB_WORKSPACE: fixturePath("projects"),
      GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
      GITHUB_OUTPUT: join(dir, "output.txt"),
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_TOKEN: "t",
      GITHUB_REPOSITORY: "acme/app",
      GITHUB_API_URL: apiUrl,
      GITHUB_BASE_REF: "main",
      INPUT_OUTPUT_DIR: join(dir, "out"),
      INPUT_PATH: "vibe-next-supabase",
      ...extraEnv,
    };
    const out: string[] = [];
    const err: string[] = [];
    const io: ActionIo = {
      env,
      stdout: (s) => void out.push(s),
      stderr: (s) => void err.push(s),
      gitShow: (ref, path) => Promise.resolve(ref === "origin/main" && path.endsWith("package-lock.json") ? readFixture("lockfiles/direct-only.package-lock.json") : null),
    };
    return { dir, env, io, out: () => out.join(""), err: () => err.join("") };
  }

  // The runner uses the real OSV endpoint unless pointed elsewhere; route it to the local server through the CLI-less path:
  // scanDirectory reads osv.endpoint from options, and runAction has no such input, so we set the fetch via the env-less default.
  // To keep this offline we monkey-patch globalThis.fetch for the runner tests.
  const realFetch = globalThis.fetch;
  function routeFetch(): void {
    globalThis.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://api.osv.dev/")) return realFetch(`${apiUrl}/v1/query`, init);
      return realFetch(input, init);
    };
  }

  it("fails the gate on the vibe fixture, writes report, SARIF, summary, outputs and a sticky PR comment", async () => {
    routeFetch();
    try {
      const t = await setup();
      const code = await runAction(t.io);
      expect(code).toBe(1);
      expect(t.err()).toContain("::error::Gateseeker gate failed");
      const outputs = await readFile(t.env.GITHUB_OUTPUT!, "utf8");
      expect(outputs).toMatch(/verdict=fail/);
      expect(outputs).toMatch(/p1=\d+/);
      expect(outputs).toContain("sarif=");
      const summary = await readFile(t.env.GITHUB_STEP_SUMMARY!, "utf8");
      expect(summary).toContain("Gateseeker: FAIL");
      expect(summary).toContain("baseline package-lock.json from origin/main");
      const report = JSON.parse(await readFile(join(t.env.INPUT_OUTPUT_DIR!, "report.json"), "utf8")) as Report;
      expect(report.baseline?.packagesCompared).toBe(2);
      const sarif = JSON.parse(await readFile(join(t.env.INPUT_OUTPUT_DIR!, "gateseeker.sarif"), "utf8")) as { runs: { results: unknown[] }[] };
      expect(sarif.runs[0]!.results.length).toBe(report.findings.length);
      expect(comments.length).toBe(1);
      expect(comments[0]!.body).toContain(SUMMARY_MARKER);
      expect(t.out()).toContain("Pull request comment created");
      // Second run updates the same comment instead of adding one.
      const code2 = await runAction(t.io);
      expect(code2).toBe(1);
      expect(comments.length).toBe(1);
      expect(t.out()).toContain("Pull request comment updated");
      await rm(t.dir, { recursive: true, force: true });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("passes on the clean fixture, declares the missing baseline, and skips the comment outside pull requests", async () => {
    routeFetch();
    try {
      const before = comments.length;
      const t = await setup({ INPUT_PATH: "clean-vite", INPUT_PATTERNS: "gate" }, false);
      t.env.GITHUB_BASE_REF = "";
      const code = await runAction(t.io);
      expect(code).toBe(0);
      expect(comments.length).toBe(before);
      const summary = await readFile(t.env.GITHUB_STEP_SUMMARY!, "utf8");
      expect(summary).toContain("Gateseeker: PASS");
      expect(summary).toContain("no baseline");
      await rm(t.dir, { recursive: true, force: true });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("incomplete fails by default and passes with allow-incomplete", async () => {
    // A directory with a lockfile whose dependency cannot be queried (git source) -> incomplete.
    const dir = await mkdtemp(join(tmpdir(), "gateseeker-inc-"));
    await writeFile(join(dir, "package-lock.json"), readFixture("lockfiles/odd-versions.package-lock.json"));
    routeFetch();
    try {
      const t = await setup({ GITHUB_WORKSPACE: dir, INPUT_PATH: ".", INPUT_ONLY: "deps", INPUT_COMMENT: "false" }, false);
      t.env.GITHUB_BASE_REF = "";
      expect(await runAction(t.io)).toBe(2);
      expect(t.err()).toContain("::error::Gateseeker analysis is incomplete");
      const t2 = await setup({ GITHUB_WORKSPACE: dir, INPUT_PATH: ".", INPUT_ONLY: "deps", INPUT_COMMENT: "false", INPUT_ALLOW_INCOMPLETE: "true" }, false);
      t2.env.GITHUB_BASE_REF = "";
      expect(await runAction(t2.io)).toBe(0);
      expect(t2.err()).toContain("::warning::Gateseeker analysis is incomplete and allow-incomplete is set");
      await rm(t.dir, { recursive: true, force: true });
      await rm(t2.dir, { recursive: true, force: true });
    } finally {
      globalThis.fetch = realFetch;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns instead of failing when the comment cannot be posted", async () => {
    failList = true;
    routeFetch();
    try {
      const t = await setup({ INPUT_PATH: "clean-vite" });
      t.env.GITHUB_BASE_REF = "";
      expect(await runAction(t.io)).toBe(0);
      expect(t.err()).toContain("::warning::Could not post the pull request comment");
      await rm(t.dir, { recursive: true, force: true });
    } finally {
      failList = false;
      globalThis.fetch = realFetch;
    }
  });

  it("returns 3 when the project cannot be analyzed", async () => {
    const t = await setup({ INPUT_PATH: "does-not-exist", INPUT_COMMENT: "false" }, false);
    t.env.GITHUB_BASE_REF = "";
    expect(await runAction(t.io)).toBe(3);
    expect(t.err()).toContain("::error::Gateseeker could not analyze the project");
    await rm(t.dir, { recursive: true, force: true });
  });

  it("upsertStickyComment reports API failures", async () => {
    failList = true;
    try {
      const r = await upsertStickyComment({ apiUrl, token: "t", repo: "acme/app" }, 1, "x");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/HTTP 403/);
    } finally {
      failList = false;
    }
  });
});

describe("scan() still accepts the lockfile-only path with the new formats", () => {
  it("renders SARIF for a lockfile scan with the lockfile as location", async () => {
    const r = await scan({ lockfilePath: fixturePath("lockfiles/direct-only.package-lock.json"), lockfileContent: readFixture("lockfiles/direct-only.package-lock.json"), osv: { fetch: osvFetch }, advisories: noAdvisories, now: fixedNow });
    if (!r.ok) throw new Error("fixture");
    const sarif = renderSarif(r.report);
    expect(sarif.runs[0]!.results.every((x) => x.locations[0]?.physicalLocation.artifactLocation.uri === "direct-only.package-lock.json")).toBe(true);
  });
});

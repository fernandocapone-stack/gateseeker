import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT, main } from "../src/cli.js";
import { renderText, sanitize } from "../src/report/text.js";
import type { Report } from "../src/types.js";
import { fixturePath, readFixture } from "./helpers.js";

/**
 * End-to-end CLI tests against a local HTTP server that impersonates the OSV
 * endpoint. Nothing here reaches the internet.
 */

let server: Server;
let endpoint: string;
const responses: Record<string, { status: number; body: string }> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString()));
    req.on("end", () => {
      const body = JSON.parse(data) as { package: { name: string } };
      const r = responses[body.package.name] ?? { status: 404, body: "{}" };
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(r.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no address");
  endpoint = `http://127.0.0.1:${addr.port}/v1/query`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => {
      if (e) reject(e);
      else resolve();
    }));
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s: string) => {
        out.push(s);
      },
      stderr: (s: string) => {
        err.push(s);
      },
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

const LODASH = readFixture("osv/lodash-4.17.20.json");

describe("gateseeker scan (CLI)", () => {
  it("exits 1 and prints prioritized findings when a vulnerability is known", async () => {
    responses["lodash"] = { status: 200, body: LODASH };
    responses["zod"] = { status: 200, body: "{}" };
    const c = capture();

    const code = await main(["scan", fixturePath("lockfiles/direct-only.package-lock.json"), "--osv-endpoint", endpoint], c.io);

    expect(code).toBe(EXIT.fail);
    const text = c.stdout();
    expect(text).toContain("[P1] lodash@4.17.20  GHSA-35jh-r3h4-6jhm (CVE-2021-23337)");
    expect(text).toContain("Command Injection in lodash");
    expect(text).toContain("severity: HIGH (CVSS 7.2)");
    expect(text).toContain("action:   Update lodash to 4.17.21 or later");
    expect(text).toContain("GATE: FAIL (fail-on P2)");
    expect(c.stderr()).toBe("");
  });

  it("exits 0 with the cautious wording when nothing is known", async () => {
    responses["lodash"] = { status: 200, body: "{}" };
    responses["zod"] = { status: 200, body: "{}" };
    const c = capture();

    const code = await main(["scan", fixturePath("lockfiles/direct-only.package-lock.json"), "--osv-endpoint", endpoint], c.io);

    expect(code).toBe(EXIT.pass);
    expect(c.stdout()).toContain("No known vulnerabilities were found in the sources consulted.");
    expect(c.stdout()).toContain("GATE: PASS");
    expect(c.stdout()).not.toMatch(/secure|safe|free of/i);
  });

  it("exits 2 when the source fails, even with no findings", async () => {
    responses["lodash"] = { status: 200, body: "{}" };
    responses["zod"] = { status: 503, body: '{"error":"unavailable"}' };
    const c = capture();

    const code = await main(["scan", fixturePath("lockfiles/direct-only.package-lock.json"), "--osv-endpoint", endpoint], c.io);

    expect(code).toBe(EXIT.incomplete);
    expect(c.stdout()).toContain("GATE: INCOMPLETE");
    expect(c.stdout()).toContain("Query for zod@4.6.7 failed: HTTP 503");
  });

  it("writes a JSON report with --format json and --output", async () => {
    responses["lodash"] = { status: 200, body: LODASH };
    responses["zod"] = { status: 200, body: "{}" };
    const dir = await mkdtemp(join(tmpdir(), "gateseeker-"));
    try {
      const outFile = join(dir, "report.json");
      const c = capture();
      const code = await main(
        ["scan", fixturePath("lockfiles/direct-only.package-lock.json"), "--osv-endpoint", endpoint, "--format", "json", "--output", outFile, "--fail-on", "P1"],
        c.io,
      );
      expect(code).toBe(EXIT.fail);
      const fromStdout = JSON.parse(c.stdout()) as Report;
      const fromFile = JSON.parse(await readFile(outFile, "utf8")) as Report;
      expect(fromFile).toEqual(fromStdout);
      expect(fromFile.gate).toMatchObject({ failOn: "P1", verdict: "fail" });
      expect(fromFile.findings.every((f) => f.aiExplanation === null)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exits 3 for rejected input (v1 lockfile) without contacting the source", async () => {
    delete responses["lodash"];
    const c = capture();
    const code = await main(["scan", fixturePath("lockfiles/v1.package-lock.json"), "--osv-endpoint", "http://127.0.0.1:9/"], c.io);
    expect(code).toBe(EXIT.usage);
    expect(c.stderr()).toContain("Input rejected (unsupported-lockfile-version)");
  });

  it("exits 3 for malformed JSON and oversize files", async () => {
    const a = capture();
    expect(await main(["scan", fixturePath("lockfiles/malformed-json.package-lock.json")], a.io)).toBe(EXIT.usage);
    expect(a.stderr()).toContain("malformed-json");

    const b = capture();
    expect(await main(["scan", fixturePath("lockfiles/direct-only.package-lock.json"), "--max-size", "10"], b.io)).toBe(EXIT.usage);
    expect(b.stderr()).toContain("too-large");
  });

  it("exits 3 on bad arguments and missing files", async () => {
    const a = capture();
    expect(await main(["scan", "does-not-exist.json"], a.io)).toBe(EXIT.usage);
    expect(a.stderr()).toContain("Cannot read");

    const b = capture();
    expect(await main(["scan", fixturePath("lockfiles/direct-only.package-lock.json"), "--fail-on", "P9"], b.io)).toBe(EXIT.usage);
    expect(b.stderr()).toContain("--fail-on must be one of P1, P2, P3, P4");

    const c = capture();
    expect(await main(["scan", fixturePath("lockfiles/direct-only.package-lock.json"), "--timeout", "abc"], c.io)).toBe(EXIT.usage);

    const d = capture();
    expect(await main(["lint", "x"], d.io)).toBe(EXIT.usage);

    const e = capture();
    expect(await main([], e.io)).toBe(EXIT.usage);
    expect(e.stdout()).toContain("Usage:");

    const f = capture();
    expect(await main(["--help"], f.io)).toBe(EXIT.pass);

    const g = capture();
    expect(await main(["--version"], g.io)).toBe(EXIT.pass);
    expect(g.stdout()).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe("text renderer hardening", () => {
  it("strips control characters and newlines from untrusted strings", () => {
    expect(sanitize("evil\u001b[31m\nname\u0007")).toBe("evil[31m name");
    expect(sanitize("a".repeat(300), 10)).toHaveLength(10);
  });

  it("renders an untrusted summary without letting it break lines", () => {
    const report: Report = {
      gateseekerVersion: "0.0.0",
      runId: "r",
      startedAt: "",
      finishedAt: "",
      project: { lockfilePath: "p", lockfileSha256: "", lockfileVersion: 3, name: null },
      dependencies: [],
      queries: [],
      findings: [
        {
          id: "X::a@1",
          kind: "dependency-vulnerability",
          subject: "a@1",
          evidence: { vulnerabilityId: "X", aliases: [], summary: "line1\nGATE: PASS\u001b[0m", details: null, published: null, modified: null, affectedRanges: null },
          source: { name: "osv.dev", queriedAt: "" },
          severity: { tier: "UNKNOWN", declared: null, cvss: [] },
          priority: "P2",
          rationale: [],
          remediation: { fixedVersions: [], action: "x" },
          references: [],
          aiExplanation: null,
        },
      ],
      summary: { dependencies: 1, queried: 1, byQueryState: { vulnerable: 1, "no-known-vulnerabilities": 0, "query-failed": 0, "not-queried": 0 }, byPriority: { P1: 0, P2: 1, P3: 0, P4: 0 } },
      sources: [],
      gate: { failOn: "P2", verdict: "fail", reason: "" },
      errors: [],
      limitations: [],
    };
    const text = renderText(report);
    expect(text).toContain("line1 GATE: PASS[0m");
    expect(text.match(/^GATE: /gm)).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { readManifest } from "../src/parser/js-lock.js";
import { DEFAULT_PARSER_LIMITS } from "../src/parser/lockfile.js";
import { parsePnpmLock } from "../src/parser/pnpm.js";
import { parseYamlDocuments, parseYamlSubset } from "../src/parser/yaml-subset.js";
import { parseYarnLock } from "../src/parser/yarn.js";
import { lockfileKind, scanDirectory } from "../src/scan.js";
import type { Dependency } from "../src/types.js";
import { fixturePath, readFixture } from "./helpers.js";

/**
 * pnpm-lock.yaml (v9) and yarn.lock (v1 and Berry), docs/SPRINT_5.md 3.4.
 * The three fixtures describe the same project as
 * lockfiles/transitive.package-lock.json plus lodash@4.17.20, a git
 * dependency and a workspace link, so the expected exposures are the same.
 */

const manifest = (dir: string) => readManifest(readFixture(`lockfiles/${dir}/package.json`));
const byKey = (deps: Dependency[]) => new Map(deps.map((d) => [`${d.name}@${d.version ?? ""}`, d]));

function expectSameProject(deps: Dependency[]) {
  const m = byKey(deps);
  expect(m.get("debug@4.3.4")?.exposure).toEqual({ direct: true, production: true });
  expect(m.get("lodash@4.17.20")?.exposure).toEqual({ direct: true, production: true });
  expect(m.get("ms@2.1.2")?.exposure).toEqual({ direct: false, production: true });
  expect(m.get("fake-test-runner@1.0.0")?.exposure).toEqual({ direct: true, production: false });
  expect(m.get("ms@2.0.0")?.exposure).toEqual({ direct: false, production: false });
  expect(m.get("tiny-git-dep@1.0.0")).toMatchObject({ versionStatus: "non-registry", exposure: { direct: true, production: true } });
  for (const d of deps) expect(d.ecosystem).toBe("npm");
}

describe("pnpm-lock.yaml", () => {
  it("reads the project document, classifies direct, dev and transitive, and skips workspace links", () => {
    const r = parsePnpmLock(readFixture("lockfiles/pnpm/pnpm-lock.yaml"), manifest("pnpm"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lockfile).toMatchObject({ format: "pnpm", lockfileVersion: 9, projectName: "fixture-pnpm" });
    expectSameProject(r.lockfile.dependencies);
    expect(r.lockfile.dependencies.map((d) => d.name)).not.toContain("pnpm");
    expect(r.lockfile.warnings.join(" ")).toContain("package manager's own lock");
    expect(r.lockfile.warnings.join(" ")).toContain('Skipped "local-tool"');
  });

  it("handles nested peer suffixes and aliases", () => {
    const text = [
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies:",
      "      plugin:",
      "        specifier: ^4.10.1",
      "        version: 4.10.1(eslint@10.13.0(jiti@2.7.0))",
      "      string-width-cjs:",
      "        specifier: npm:string-width@^4.2.0",
      "        version: string-width@4.2.3",
      "packages:",
      "  plugin@4.10.1:",
      "    resolution: {integrity: sha512-fixture}",
      "  string-width@4.2.3:",
      "    resolution: {integrity: sha512-fixture}",
      "  eslint@10.13.0:",
      "    resolution: {integrity: sha512-fixture}",
      "snapshots:",
      "  plugin@4.10.1(eslint@10.13.0(jiti@2.7.0)):",
      "    dependencies:",
      "      eslint: 10.13.0(jiti@2.7.0)",
      "  string-width@4.2.3: {}",
      "  eslint@10.13.0(jiti@2.7.0): {}",
      "",
    ].join("\n");
    const r = parsePnpmLock(text, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = byKey(r.lockfile.dependencies);
    expect(m.get("plugin@4.10.1")?.exposure).toEqual({ direct: true, production: true });
    expect(m.get("string-width@4.2.3")?.exposure).toEqual({ direct: true, production: true });
    expect(m.get("eslint@10.13.0")?.exposure).toEqual({ direct: false, production: true });
  });

  it("rejects older lockfile versions, malformed YAML and oversized input", () => {
    expect(parsePnpmLock("lockfileVersion: '6.0'\npackages: {}\n", null)).toMatchObject({ ok: false, error: { code: "unsupported-lockfile-version" } });
    expect(parsePnpmLock("lockfileVersion: '9.0'\nimporters:\n\t.:\n", null)).toMatchObject({ ok: false, error: { code: "malformed-yaml" } });
    expect(parsePnpmLock("lockfileVersion: '9.0'\npackages:\n  a@1.0.0:\n    resolution: [not, a, map\n  a@1.0.0: {}\n", null)).toMatchObject({ ok: false, error: { code: "malformed-yaml" } });
    expect(parsePnpmLock("x".repeat(200), null, { ...DEFAULT_PARSER_LIMITS, maxBytes: 100 })).toMatchObject({ ok: false, error: { code: "too-large" } });
    const content = readFixture("lockfiles/pnpm/pnpm-lock.yaml");
    expect(parsePnpmLock(content, null, { ...DEFAULT_PARSER_LIMITS, maxDependencies: 3 })).toMatchObject({ ok: false, error: { code: "too-many-dependencies" } });
  });

  it("treats everything as production when snapshots are missing, and says so", () => {
    const r = parsePnpmLock("lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      a:\n        specifier: 1.0.0\n        version: 1.0.0\npackages:\n  a@1.0.0:\n    resolution: {integrity: x}\n", null);
    expect(r.ok && r.lockfile.dependencies[0]?.exposure).toEqual({ direct: true, production: true });
    expect(r.ok && r.lockfile.warnings.join(" ")).toContain("no snapshots section");
  });
});

describe("yarn.lock", () => {
  it("reads Yarn 1 with package.json deciding direct and dev", () => {
    const r = parseYarnLock(readFixture("lockfiles/yarn-v1/yarn.lock"), manifest("yarn-v1"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lockfile).toMatchObject({ format: "yarn-v1", lockfileVersion: null, projectName: "fixture-yarn-v1" });
    expectSameProject(r.lockfile.dependencies);
  });

  it("reads Berry, follows workspace entries and patch descriptors", () => {
    const r = parseYarnLock(readFixture("lockfiles/yarn-berry/yarn.lock"), manifest("yarn-berry"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lockfile).toMatchObject({ format: "yarn-berry", lockfileVersion: 8, projectName: "fixture-yarn-berry" });
    expectSameProject(r.lockfile.dependencies);
    expect(byKey(r.lockfile.dependencies).get("typescript@5.4.5")?.exposure).toEqual({ direct: true, production: false });
    expect(r.lockfile.dependencies.filter((d) => d.name === "typescript")).toHaveLength(1);
    expect(r.lockfile.warnings.join(" ")).toContain("patched package");
  });

  it("without package.json treats every package as production and none as direct", () => {
    const r = parseYarnLock(readFixture("lockfiles/yarn-v1/yarn.lock"), null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const d of r.lockfile.dependencies) expect(d.exposure).toEqual({ direct: false, production: true });
    expect(r.lockfile.warnings.join(" ")).toContain("No package.json next to yarn.lock");
  });

  it("rejects malformed Yarn 1 files", () => {
    expect(parseYarnLock("# yarn lockfile v1\n\nlodash@^4\n  version \"4.17.20\"\n", null)).toMatchObject({ ok: false, error: { code: "malformed-lockfile" } });
    expect(parseYarnLock("# yarn lockfile v1\n  version \"1.0.0\"\n", null)).toMatchObject({ ok: false, error: { code: "malformed-lockfile" } });
    expect(parseYarnLock("# yarn lockfile v1\n\nlodash@^4:\n  resolved \"x\"\n", null)).toMatchObject({ ok: true });
  });
});

describe("YAML subset reader", () => {
  it("reads quoted keys, flow collections as text, sequences and block scalars", () => {
    const r = parseYamlSubset("'@a/b@1.0.0':\n  resolution: {integrity: x, tarball: 'y'}\n  os: [darwin]\n  cpu:\n    - x64\n    - arm64\n  note: |\n    line one\n    line two\n\"k: v\": 'it''s'\nplain: value # comment\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value["@a/b@1.0.0"]).toEqual({ resolution: "{integrity: x, tarball: 'y'}", os: "[darwin]", cpu: ["x64", "arm64"], note: "line one\nline two" });
    expect(r.value["k: v"]).toBe("it's");
    expect(r.value.plain).toBe("value");
  });

  it("refuses prototype keys, duplicates, tabs and bad indentation, and creates no prototype", () => {
    expect(parseYamlSubset("__proto__:\n  polluted: yes\n")).toMatchObject({ ok: false });
    expect(parseYamlSubset("a: 1\na: 2\n")).toMatchObject({ ok: false, message: expect.stringContaining("Duplicate") as string });
    expect(parseYamlSubset("a:\n\tb: 1\n")).toMatchObject({ ok: false });
    expect(parseYamlSubset("a:\n    b: 1\n  c: 2\n")).toMatchObject({ ok: false, message: "Inconsistent indentation." });
    const r = parseYamlSubset("a:\n  b: 1\n");
    expect(r.ok && Object.getPrototypeOf(r.value)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("splits documents and caps depth", () => {
    const docs = parseYamlDocuments("---\na: 1\n---\nb: 2\n");
    expect(docs.ok && docs.documents).toEqual([{ a: "1" }, { b: "2" }]);
    const deep = Array.from({ length: 40 }, (_, i) => `${" ".repeat(i * 2)}k${String(i)}:`).join("\n") + `\n${" ".repeat(80)}v: 1\n`;
    expect(parseYamlSubset(deep)).toMatchObject({ ok: false, message: expect.stringContaining("Nesting deeper") as string });
  });

  it("stays fast on adversarial input (ReDoS and size budget)", () => {
    const inputs = [
      "a: ".repeat(1_500_000),
      `k: "${"\\\"".repeat(800_000)}`,
      `${"x".repeat(2_000_000)}:\n`,
      Array.from({ length: 200_000 }, (_, i) => `p${String(i)}: {${"a: b, ".repeat(3)}}`).join("\n"),
      "- ".repeat(1_000_000),
      `'${"''".repeat(1_000_000)}': 1`,
    ];
    for (const input of inputs) {
      const start = performance.now();
      parseYamlDocuments(input);
      parseYarnLock(`# yarn lockfile v1\n\n${input}`, null);
      expect(performance.now() - start).toBeLessThan(2000);
    }
  });
});

describe("scan integration", () => {
  it("detects pnpm and Yarn lockfiles by name and by content", () => {
    expect(lockfileKind("a/pnpm-lock.yaml")).toBe("pnpm-lock.yaml");
    expect(lockfileKind("a/yarn.lock")).toBe("yarn.lock");
    expect(lockfileKind("x.txt", "lockfileVersion: '9.0'\n")).toBe("pnpm-lock.yaml");
    expect(lockfileKind("x.txt", "# yarn lockfile v1\n")).toBe("yarn.lock");
    expect(lockfileKind("x.txt", "__metadata:\n  version: 8\n")).toBe("yarn.lock");
  });

  for (const dir of ["pnpm", "yarn-v1", "yarn-berry"]) {
    it(`${dir}: queries OSV for every registry package and reports lodash, leaving the git dependency unqueried`, async () => {
      const lodash = readFixture("osv/lodash-4.17.20.json");
      const queried: string[] = [];
      const fetchFn: typeof fetch = (_url, init) => {
        const body = JSON.parse(init?.body as string) as { package: { name: string }; version: string };
        queried.push(`${body.package.name}@${body.version}`);
        return Promise.resolve(new Response(body.package.name === "lodash" ? lodash : "{}", { status: 200, headers: { "content-type": "application/json" } }));
      };
      const r = await scanDirectory({ root: fixturePath(`lockfiles/${dir}`), only: "deps", osv: { fetch: fetchFn }, advisories: { advisories: [], origin: "test", digest: "0000000000000000", problems: [] }, now: () => new Date("2026-10-30T12:00:00Z") });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(queried.sort()).toEqual(expect.arrayContaining(["debug@4.3.4", "fake-test-runner@1.0.0", "lodash@4.17.20", "ms@2.0.0", "ms@2.1.2"]));
      expect(queried.some((q) => q.startsWith("tiny-git-dep"))).toBe(false);
      expect(r.report.analyses.dependencies).toBe("analyzed");
      expect(r.report.findings.some((f) => f.subject === "lodash@4.17.20" && f.kind === "dependency-vulnerability")).toBe(true);
      expect(r.report.queries.find((q) => q.dependency.startsWith("tiny-git-dep"))?.state).toBe("not-queried");
      // A gated lodash finding fails the gate; without it the unqueried git dependency would make it incomplete, never pass.
      expect(r.report.gate.verdict).toBe("fail");
    });
  }
});

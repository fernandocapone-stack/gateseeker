import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARSER_LIMITS,
  compareSemver,
  isStrictSemver,
  packageNameFromPath,
  parseLockfile,
} from "../src/parser/lockfile.js";
import { readFixture } from "./helpers.js";

function parseOk(content: string, limits = DEFAULT_PARSER_LIMITS) {
  const result = parseLockfile(content, limits);
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.lockfile;
}

function parseErr(content: string, limits = DEFAULT_PARSER_LIMITS) {
  const result = parseLockfile(content, limits);
  if (result.ok) throw new Error("expected error, got ok");
  return result.error;
}

describe("parseLockfile: valid files", () => {
  it("identifies direct production dependencies in a v3 lockfile", () => {
    const lf = parseOk(readFixture("lockfiles/direct-only.package-lock.json"));
    expect(lf.lockfileVersion).toBe(3);
    expect(lf.projectName).toBe("fixture-direct-only");
    expect(lf.warnings).toEqual([]);
    expect(lf.dependencies).toEqual([
      {
        name: "lodash",
        version: "4.17.20",
        ecosystem: "npm",
        versionStatus: "ok",
        exposure: { direct: true, production: true },
        paths: ["node_modules/lodash"],
      },
      {
        name: "zod",
        version: "4.6.7",
        ecosystem: "npm",
        versionStatus: "ok",
        exposure: { direct: true, production: true },
        paths: ["node_modules/zod"],
      },
    ]);
  });

  it("distinguishes direct, transitive, dev and nested copies", () => {
    const lf = parseOk(readFixture("lockfiles/transitive.package-lock.json"));
    const byKey = new Map(lf.dependencies.map((d) => [`${d.name}@${d.version}`, d]));

    expect([...byKey.keys()].sort()).toEqual([
      "debug@4.3.4",
      "fake-test-runner@1.0.0",
      "ms@2.0.0",
      "ms@2.1.2",
    ]);
    expect(byKey.get("debug@4.3.4")?.exposure).toEqual({ direct: true, production: true });
    expect(byKey.get("ms@2.1.2")?.exposure).toEqual({ direct: false, production: true });
    expect(byKey.get("fake-test-runner@1.0.0")?.exposure).toEqual({
      direct: true,
      production: false,
    });
    // Nested copy under a dev dependency: transitive and dev-only.
    expect(byKey.get("ms@2.0.0")?.exposure).toEqual({ direct: false, production: false });
    expect(byKey.get("ms@2.0.0")?.paths).toEqual(["node_modules/fake-test-runner/node_modules/ms"]);
  });

  it("reads a v2 lockfile from its packages block and ignores the legacy block", () => {
    const lf = parseOk(readFixture("lockfiles/v2.package-lock.json"));
    expect(lf.lockfileVersion).toBe(2);
    expect(lf.dependencies).toHaveLength(1);
    expect(lf.dependencies[0]).toMatchObject({ name: "lodash", version: "4.17.20" });
  });

  it("merges exposure when the same name@version appears in several paths", () => {
    const content = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { a: "1.0.0" }, devDependencies: { b: "1.0.0" } },
        "node_modules/a": { version: "1.0.0", dependencies: { c: "1.0.0" } },
        "node_modules/a/node_modules/c": { version: "1.0.0" },
        "node_modules/b": { version: "1.0.0", dev: true, dependencies: { c: "1.0.0" } },
        "node_modules/b/node_modules/c": { version: "1.0.0", dev: true },
      },
    });
    const lf = parseOk(content);
    const c = lf.dependencies.find((d) => d.name === "c");
    expect(c?.exposure).toEqual({ direct: false, production: true });
    expect(c?.paths).toHaveLength(2);
  });
});

describe("parseLockfile: odd versions", () => {
  it("classifies missing, non-registry and non-semver versions explicitly", () => {
    const lf = parseOk(readFixture("lockfiles/odd-versions.package-lock.json"));
    const status = Object.fromEntries(lf.dependencies.map((d) => [d.name, d.versionStatus]));
    expect(status).toEqual({
      "no-version-pkg": "missing",
      "git-pkg": "non-registry",
      "weird-version-pkg": "non-semver",
      zod: "ok",
    });
    expect(lf.dependencies.find((d) => d.name === "no-version-pkg")?.version).toBeNull();
    // The file: symlink and its workspace target are skipped with a warning each.
    expect(lf.dependencies.map((d) => d.name)).not.toContain("local-pkg");
    expect(lf.warnings).toHaveLength(2);
    expect(lf.warnings.join("\n")).toMatch(/symlink/);
    expect(lf.warnings.join("\n")).toMatch(/workspace/);
  });
});

describe("parseLockfile: rejections", () => {
  it("rejects lockfileVersion 1", () => {
    const err = parseErr(readFixture("lockfiles/v1.package-lock.json"));
    expect(err.code).toBe("unsupported-lockfile-version");
    expect(err.message).toContain("lockfileVersion 1");
  });

  it("rejects an unknown future lockfileVersion", () => {
    const err = parseErr(JSON.stringify({ lockfileVersion: 9, packages: {} }));
    expect(err.code).toBe("unsupported-lockfile-version");
  });

  it("rejects malformed JSON", () => {
    const err = parseErr(readFixture("lockfiles/malformed-json.package-lock.json"));
    expect(err.code).toBe("malformed-json");
  });

  it("rejects valid JSON that does not match the schema", () => {
    const err = parseErr(readFixture("lockfiles/malformed-schema.package-lock.json"));
    expect(err.code).toBe("invalid-schema");
    expect(err.message).toContain("packages");
  });

  it("rejects a non-object root", () => {
    expect(parseErr("[]").code).toBe("invalid-schema");
    expect(parseErr("null").code).toBe("invalid-schema");
  });

  it("rejects files above the size limit before parsing them", () => {
    const content = readFixture("lockfiles/direct-only.package-lock.json");
    const err = parseErr(content, { ...DEFAULT_PARSER_LIMITS, maxBytes: 100 });
    expect(err.code).toBe("too-large");
    expect(err.message).toMatch(/limit is 100 bytes/);
  });

  it("accepts a file exactly at the size limit", () => {
    const content = readFixture("lockfiles/direct-only.package-lock.json");
    const exact = Buffer.byteLength(content, "utf8");
    expect(parseLockfile(content, { ...DEFAULT_PARSER_LIMITS, maxBytes: exact }).ok).toBe(true);
    expect(parseLockfile(content, { ...DEFAULT_PARSER_LIMITS, maxBytes: exact - 1 }).ok).toBe(false);
  });

  it("rejects a generated lockfile larger than the default limit", () => {
    const packages: Record<string, unknown> = { "": {} };
    // ~6 MB of entries.
    for (let i = 0; i < 60_000; i++) {
      packages[`node_modules/pkg-${i}`] = {
        version: "1.0.0",
        resolved: `https://registry.npmjs.org/pkg-${i}/-/pkg-${i}-1.0.0.tgz`,
      };
    }
    const content = JSON.stringify({ lockfileVersion: 3, packages });
    expect(Buffer.byteLength(content)).toBeGreaterThan(DEFAULT_PARSER_LIMITS.maxBytes);
    expect(parseErr(content).code).toBe("too-large");
  });

  it("rejects lockfiles with more packages than allowed", () => {
    const content = readFixture("lockfiles/transitive.package-lock.json");
    const err = parseErr(content, { ...DEFAULT_PARSER_LIMITS, maxDependencies: 3 });
    expect(err.code).toBe("too-many-dependencies");
    expect(err.message).toMatch(/lists 4 packages; limit is 3/);
    expect(parseLockfile(content, { ...DEFAULT_PARSER_LIMITS, maxDependencies: 4 }).ok).toBe(true);
  });
});

describe("helpers", () => {
  it("isStrictSemver", () => {
    expect(isStrictSemver("1.2.3")).toBe(true);
    expect(isStrictSemver("1.2.3-beta.1+build.5")).toBe(true);
    expect(isStrictSemver("v1.2.3")).toBe(false);
    expect(isStrictSemver("1.x")).toBe(false);
    expect(isStrictSemver("^1.2.3")).toBe(false);
    expect(isStrictSemver("01.2.3")).toBe(false);
  });

  it("compareSemver follows semver precedence, not string order", () => {
    expect(["4.9.0", "4.10.0", "4.17.21"].sort(compareSemver)).toEqual(["4.9.0", "4.10.0", "4.17.21"]);
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBeLessThan(0);
    expect(compareSemver("1.0.0-beta.11", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
    expect(compareSemver("2.0.0", "10.0.0")).toBeLessThan(0);
  });

  it("packageNameFromPath handles scopes and nesting", () => {
    expect(packageNameFromPath("node_modules/lodash")).toBe("lodash");
    expect(packageNameFromPath("node_modules/@scope/pkg")).toBe("@scope/pkg");
    expect(packageNameFromPath("node_modules/a/node_modules/@s/b")).toBe("@s/b");
    expect(packageNameFromPath("packages/workspace-a")).toBeNull();
    expect(packageNameFromPath("node_modules/")).toBeNull();
  });
});

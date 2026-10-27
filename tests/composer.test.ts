import { describe, expect, it } from "vitest";
import { normalizeComposerVersion, parseComposerLock } from "../src/parser/composer.js";
import { DEFAULT_PARSER_LIMITS } from "../src/parser/lockfile.js";
import { readFixture } from "./helpers.js";

const LOCK = readFixture("composer/basic/composer.lock");
const JSON_ = readFixture("composer/basic/composer.json");

function ok(lock: string, json: string | null = JSON_, limits = DEFAULT_PARSER_LIMITS) {
  const r = parseComposerLock(lock, json, limits);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.lockfile;
}
function err(lock: string, json: string | null = JSON_, limits = DEFAULT_PARSER_LIMITS) {
  const r = parseComposerLock(lock, json, limits);
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

describe("parseComposerLock", () => {
  it("reads packages and packages-dev with exposure from composer.json", () => {
    const lf = ok(LOCK);
    expect(lf.projectName).toBe("gateseeker/fixture-basic");
    expect(lf.pluginApiVersion).toBe("2.6.0");
    expect(lf.warnings).toEqual([]);
    const byName = Object.fromEntries(lf.dependencies.map((d) => [d.name, d]));
    expect(Object.keys(byName).sort()).toEqual(["acme/bleeding-edge", "acme/local-helper", "laravel-lang/lang", "laravel/framework", "monolog/monolog", "phpunit/phpunit"]);
    expect(byName["laravel/framework"]).toMatchObject({ version: "12.3.0", ecosystem: "Packagist", versionStatus: "ok", exposure: { direct: true, production: true }, sourceReference: "1111111111111111111111111111111111111111", releasedAt: "2026-03-01T10:00:00+00:00" });
    expect(byName["monolog/monolog"]).toMatchObject({ versionStatus: "ok", exposure: { direct: false, production: true }, paths: ["packages/monolog/monolog"] });
    expect(byName["phpunit/phpunit"]).toMatchObject({ exposure: { direct: true, production: false }, paths: ["packages-dev/phpunit/phpunit"] });
    expect(byName["acme/bleeding-edge"]).toMatchObject({ version: "dev-main", versionStatus: "non-semver" });
    expect(byName["acme/local-helper"]).toMatchObject({ versionStatus: "non-registry", sourceUrl: null });
  });

  it("keeps install scripts and autoload files on entries for the supply-chain rules", () => {
    const lf = ok(LOCK);
    const helper = lf.entries.find((e) => e.name === "acme/local-helper");
    expect(helper?.scripts).toEqual(["post-install-cmd"]);
    expect(helper?.autoloadFiles).toEqual(["src/helpers.php"]);
    expect(lf.entries.find((e) => e.name === "laravel-lang/lang")?.autoloadFiles).toEqual([]);
  });

  it("normalizes a leading v and classifies odd versions", () => {
    expect(normalizeComposerVersion("v12.3.0")).toBe("12.3.0");
    expect(normalizeComposerVersion("12.3.0")).toBe("12.3.0");
    expect(normalizeComposerVersion("dev-main")).toBe("dev-main");
    const lock = JSON.stringify({ packages: [{ name: "a/b", version: "1.2.3.4", dist: { type: "zip", url: "https://api.github.com/repos/a/b/zipball/x" } }, { name: "c/d", version: "2.0.x-dev", dist: { type: "zip", url: "https://api.github.com/repos/c/d/zipball/y" } }] });
    const lf = ok(lock, null);
    // Four-part numeric versions are valid Composer versions and are queried as written; branch aliases are not.
    expect(lf.dependencies.map((d) => [d.name, d.versionStatus])).toEqual([["a/b", "ok"], ["c/d", "non-semver"]]);
    expect(lf.warnings[0]).toMatch(/composer.json not found/);
  });

  it("rejects malformed, oversize and oversized package lists", () => {
    expect(err(readFixture("composer/malformed-schema.composer.lock")).code).toBe("invalid-schema");
    expect(err("{ not json").code).toBe("malformed-json");
    expect(err(LOCK, JSON_, { ...DEFAULT_PARSER_LIMITS, maxBytes: 100 }).code).toBe("too-large");
    expect(err(LOCK, JSON_, { ...DEFAULT_PARSER_LIMITS, maxDependencies: 3 }).code).toBe("too-many-dependencies");
    expect(parseComposerLock(LOCK, JSON_, { ...DEFAULT_PARSER_LIMITS, maxDependencies: 6 }).ok).toBe(true);
  });

  it("tolerates a broken composer.json with a warning instead of failing", () => {
    const lf = ok(LOCK, "{ broken");
    expect(lf.warnings[0]).toMatch(/composer.json is not valid JSON/);
    expect(lf.dependencies.every((d) => !d.exposure.direct)).toBe(true);
  });
});

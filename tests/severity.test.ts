import { describe, expect, it } from "vitest";
import { osvQueryResponseSchema } from "../src/intel/osv-schema.js";
import { cvss3BaseScore, cvss3Tier } from "../src/rules/cvss.js";
import { deriveSeverity } from "../src/rules/severity.js";
import { readJsonFixture } from "./helpers.js";

describe("cvss3BaseScore", () => {
  // Reference values from published advisories (NVD / GitHub Advisory Database).
  it.each([
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
    ["CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H", 7.2], // CVE-2021-23337
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L", 5.3], // CVE-2020-28500
    ["CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H", 8.1], // CVE-2026-4800
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L", 6.5], // CVE-2025-13465
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N", 6.1], // typical reflected XSS
    ["CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N", 3.3],
    ["CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", 9.8],
    ["CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N", 0],
  ])("%s -> %d", (vector, expected) => {
    expect(cvss3BaseScore(vector)).toBe(expected);
  });

  it("returns null for vectors it does not understand", () => {
    expect(cvss3BaseScore("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:L/VA:L/SC:H/SI:H/SA:H")).toBeNull();
    expect(cvss3BaseScore("AV:N/AC:L/Au:N/C:P/I:P/A:P")).toBeNull(); // CVSS v2
    expect(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H")).toBeNull(); // missing A
    expect(cvss3BaseScore("CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBeNull(); // bad value
    expect(cvss3BaseScore("")).toBeNull();
  });

  it("maps scores to the qualitative scale", () => {
    expect(cvss3Tier(0)).toBe("NONE");
    expect(cvss3Tier(0.1)).toBe("LOW");
    expect(cvss3Tier(3.9)).toBe("LOW");
    expect(cvss3Tier(4.0)).toBe("MODERATE");
    expect(cvss3Tier(6.9)).toBe("MODERATE");
    expect(cvss3Tier(7.0)).toBe("HIGH");
    expect(cvss3Tier(8.9)).toBe("HIGH");
    expect(cvss3Tier(9.0)).toBe("CRITICAL");
    expect(cvss3Tier(10)).toBe("CRITICAL");
  });
});

describe("deriveSeverity", () => {
  const lodash = osvQueryResponseSchema.parse(readJsonFixture("osv/lodash-4.17.20.json"));
  const byId = new Map((lodash.vulns ?? []).map((v) => [v.id, v]));

  it("scores CVSS 3.x from the real lodash record and keeps the declared value", () => {
    const sev = deriveSeverity(byId.get("GHSA-35jh-r3h4-6jhm")!);
    expect(sev.tier).toBe("HIGH");
    expect(sev.declared).toBe("HIGH");
    expect(sev.cvss).toEqual([
      { type: "CVSS_V3", vector: "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H", score: 7.2 },
    ]);
  });

  it("uses the highest scored vector and leaves v4 unscored", () => {
    const sev = deriveSeverity(byId.get("GHSA-xxjr-mmjv-4gpg")!);
    expect(sev.tier).toBe("MODERATE");
    expect(sev.cvss.map((c) => [c.type, c.score])).toEqual([
      ["CVSS_V3", 6.5],
      ["CVSS_V4", null],
    ]);
  });

  it("falls back to the declared severity when no vector is scorable", () => {
    const sev = deriveSeverity({ id: "X", severity: [{ type: "CVSS_V4", score: "CVSS:4.0/..." }], database_specific: { severity: "MEDIUM" } });
    expect(sev.tier).toBe("MODERATE");
    expect(sev.declared).toBe("MEDIUM");
  });

  it("is UNKNOWN when the source gives nothing, never LOW", () => {
    const noSev = osvQueryResponseSchema.parse(readJsonFixture("osv/no-severity.json"));
    const sev = deriveSeverity(noSev.vulns![0]!);
    expect(sev).toEqual({ tier: "UNKNOWN", declared: null, cvss: [] });
  });

  it("is UNKNOWN for an unrecognised declared value", () => {
    expect(deriveSeverity({ id: "X", database_specific: { severity: "SEVERE" } }).tier).toBe("UNKNOWN");
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOGO_SYMBOL, LOGO_WORDMARK, renderPdf, svgPathToPdf, toWinAnsi, type PdfReport } from "../src/report/pdf.js";
import { scanDirectory } from "../src/scan.js";
import type { Finding, Report } from "../src/types.js";
import { fixturePath, readJsonFixture } from "./helpers.js";

/**
 * The PDF behind the page's "Download PDF" button: a valid file (header,
 * objects at the offsets the xref claims, trailer), report strings that stay
 * text however they are crafted, no secret from the scanned project, and
 * pagination for long reports. No network: patterns only.
 */

const VIBE = fixturePath("projects/vibe-next-supabase");
const SECRETS = readJsonFixture("projects/secrets.json") as Record<string, string>;
const META = { subject: "acme/vibe@0123456", exportedAt: new Date("2026-10-29T12:00:00Z") };
const latin1 = (b: Uint8Array): string => Array.from(b, (c) => String.fromCharCode(c)).join("");

let report: Report;
beforeAll(async () => {
  const r = await scanDirectory({ root: VIBE, only: "patterns", patternsMode: "warn", now: () => new Date("2026-10-29T12:00:00Z"), runId: "t" });
  if (!r.ok) throw new Error("fixture scan failed");
  report = r.report;
});

function withFindings(findings: Finding[]): PdfReport {
  return { ...report, findings };
}

function firstPattern(): Finding {
  const f = report.findings.find((x) => x.evidence.kind === "insecure-pattern");
  if (!f) throw new Error("fixture has no pattern finding");
  return f;
}

describe("renderPdf", () => {
  it("writes a structurally valid PDF whose xref offsets point at the objects", () => {
    const text = latin1(renderPdf(report, META));
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThan(5);
    entries.forEach((offset, i) => {
      expect(text.slice(offset, offset + `${String(i + 1)} 0 obj`.length)).toBe(`${String(i + 1)} 0 obj`);
    });
    // Each content stream's declared length matches its bytes.
    for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = (m.index ?? 0) + m[0].length;
      expect(text.slice(start + Number(m[1]), start + Number(m[1]) + "\nendstream".length)).toBe("\nendstream");
    }
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).not.toMatch(/\/(JavaScript|JS|OpenAction|Launch|URI)\b/);
  });

  it("carries the verdict, the findings and the fixed wording", () => {
    const text = latin1(renderPdf(report, META));
    expect(text).toContain(`(${report.gate.verdict === "pass" ? "PASS" : report.gate.verdict === "fail" ? "FAIL" : "INCOMPLETE"}) Tj`);
    expect(text).toContain("GSK-SECRET-001");
    expect(text).toContain("acme/vibe@0123456");
    expect(text).toContain("not that a project is secure");
  });

  it("never lets report strings escape the text string they are drawn in", () => {
    const base = firstPattern();
    const hostile = { ...base, subject: "evil) Tj ET /OpenAction << /S /JavaScript >> BT (x\\", remediation: { ...base.remediation, action: "line1\nline2\u001b[31m\u0007 ‮ reversed" } };
    const text = latin1(renderPdf(withFindings([hostile]), { ...META, subject: "o/r (x) \\ y" }));
    expect(text).toContain("evil\\) Tj ET /OpenAction << /S /JavaScript >> BT \\(x\\\\");
    expect(text).not.toMatch(/\/OpenAction << \/S \/JavaScript >> BT \(x[^\\]/);
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u0007");
    expect(text).toContain("line1 line2");
    // Every literal string in the content streams is balanced once escapes are removed.
    for (const m of text.matchAll(/\((?:\\.|[^\\()])*\) Tj/g)) expect(m[0].endsWith(") Tj")).toBe(true);
    const unbalanced = text.replace(/\\[\\()]/g, "").split("\n").filter((l) => l.includes(" Tj ") && (l.split("(").length !== l.split(")").length));
    expect(unbalanced).toEqual([]);
  });

  it("contains no full credential from the scanned project", () => {
    const text = latin1(renderPdf(report, META));
    for (const [name, value] of Object.entries(SECRETS)) {
      if (name !== "anon") expect(text, `secret ${name} reached the PDF`).not.toContain(value);
    }
  });

  it("paginates a long report and numbers every page", () => {
    const base = firstPattern();
    const many = Array.from({ length: 150 }, (_, i) => ({ ...base, id: `f-${String(i)}`, subject: `src/file-${String(i)}.ts:${String(i)}` }));
    const text = latin1(renderPdf(withFindings(many), META));
    const count = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(text)?.[1]);
    expect(count).toBeGreaterThan(5);
    expect(text).toContain(`(Page 1 of ${String(count)}) Tj`);
    expect(text).toContain(`(Page ${String(count)} of ${String(count)}) Tj`);
    expect(text).toContain("src/file-149.ts:149");
  });

  it("is deterministic for the same input", () => {
    expect(latin1(renderPdf(report, META))).toBe(latin1(renderPdf(report, META)));
  });

  it("stays fast on a long unbroken string (wrapping budget)", () => {
    const base = firstPattern();
    const long = { ...base, remediation: { ...base.remediation, action: "x".repeat(1900) }, references: [{ type: "WEB", url: `https://example.com/${"a".repeat(1500)}` }] };
    const t0 = performance.now();
    const text = latin1(renderPdf(withFindings(Array.from({ length: 20 }, () => long)), META));
    expect(performance.now() - t0).toBeLessThan(2000);
    // Wrapped inside the margins: Helvetica "x" is 500/1000 em, so at 9.5 pt a 495 pt line holds at most 104 of them.
    const runs = [...text.matchAll(/\((x+)\) Tj/g)].map((m) => m[1]?.length ?? 0);
    expect(runs.length).toBeGreaterThan(18);
    expect(Math.max(...runs)).toBeLessThanOrEqual(104);
    // The action is capped at 600 characters and ends with an ellipsis (WinAnsi 0x85) instead of running on.
    expect(text).toMatch(/\(x+\x85\) Tj/);
    expect(text).not.toContain("x".repeat(105));
  });
});

describe("logo", () => {
  it("uses the same paths as the ui-kit <Logo> (the PO's Figma export)", () => {
    const source = readFileSync(join(process.cwd(), "ui-kit", "src", "logo.tsx"), "utf8");
    expect(/const SYMBOL = "([^"]*)"/.exec(source)?.[1]).toBe(LOGO_SYMBOL);
    expect(/const WORDMARK = "([^"]*)"/.exec(source)?.[1]).toBe(LOGO_WORDMARK);
  });

  it("converts absolute SVG commands, flipping y, and refuses anything else", () => {
    expect(svgPathToPdf("M0 0L10 0H20V5C1 2 3 4 5 6Z", 2, 100, 500)).toBe("100 500 m 120 500 l 140 500 l 140 490 l 102 496 106 492 110 488 c h");
    // Exponent notation, as in the Figma export.
    expect(svgPathToPdf("M8.16603e-05 1e-2", 1, 0, 0)).toBe("0 -0.01 m");
    expect(() => svgPathToPdf("M0 0 a1 1 0 0 1 2 2", 1, 0, 0)).toThrow(/unsupported/);
  });

  it("draws the logo at the top of the first page, filled in brand colour and ink", () => {
    const text = latin1(renderPdf(report, META));
    const firstContent = /stream\n([\s\S]*?)\nendstream/.exec(text)?.[1] ?? "";
    expect(firstContent.startsWith("0.71 0.47 1 rg ")).toBe(true);
    expect(firstContent).toMatch(/ h f\n0\.1 0\.1 0\.12 rg /);
    expect(firstContent.split("\n")[1]?.endsWith(" f")).toBe(true);
  });
});

describe("toWinAnsi", () => {
  it("keeps ASCII and Latin-1, maps typographic punctuation, replaces the rest", () => {
    expect(toWinAnsi("Análise ção")).toBe("Análise ção");
    expect(toWinAnsi("a – b — c … “d” ‘e’ •")).toBe("a \x96 b \x97 c \x85 \x93d\x94 \x91e\x92 \x95");
    expect(toWinAnsi("P1 → P2")).toBe("P1 -> P2");
    expect(toWinAnsi("日本 🚀")).toBe("?? ?");
  });
});

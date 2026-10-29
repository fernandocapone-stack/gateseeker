import type { Finding, Report } from "../types.js";
import { sanitize } from "./text.js";

/**
 * Dependency-free PDF writer for a report, the file behind the page's
 * "Download PDF" button. It runs in the browser and in Node (no Node
 * imports), writes PDF 1.4 with the three standard fonts (no embedding) and
 * lays the report out as a plain document: verdict, counts per priority,
 * every finding with its evidence, errors and limitations.
 *
 * Every string from the report is untrusted. Each one goes through
 * `sanitize()` (control characters and newlines removed, length capped), is
 * mapped to WinAnsi (anything else becomes "?") and has `\`, `(` and `)`
 * escaped before it enters a content stream, so report content can only ever
 * be text: it cannot close a string, add operators or create links or
 * actions. Snippets were already redacted by the engine; nothing here adds
 * data the JSON report does not carry.
 */

export type PdfReport = Pick<Report, "gate" | "summary" | "analyses" | "patterns" | "findings" | "errors" | "limitations" | "sources" | "gateseekerVersion">;

export interface PdfMeta {
  /** What was analyzed, e.g. "owner/repo@abc1234". */
  subject: string;
  exportedAt: Date;
  /** Extra facts for the caption line, already in plain words (e.g. "312 files read"). */
  notes?: string[];
}

const PRIORITY_LABEL: Record<string, string> = { P1: "Fix now", P2: "Fix before release", P3: "Plan a fix", P4: "Keep an eye on it" };
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, MEDIUM: 2, LOW: 3 };

// --- text encoding -------------------------------------------------------------

/* Unicode -> WinAnsi byte for the few characters outside Latin-1 that reports use. */
const WIN_ANSI_EXTRA: Record<number, number> = { 0x20ac: 0x80, 0x2026: 0x85, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97 };

/** Maps to WinAnsi bytes (as a latin1 string); unknown characters become "?". */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0x3f;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) out += ch;
    else if (c === 0x2192) out += "->";
    else if (WIN_ANSI_EXTRA[c] !== undefined) out += String.fromCharCode(WIN_ANSI_EXTRA[c]);
    else out += "?";
  }
  return out;
}

function escapePdfString(winAnsi: string): string {
  return winAnsi.replace(/[\\()]/g, (m) => `\\${m}`);
}

// --- metrics ------------------------------------------------------------------

/* Glyph widths (1/1000 em) for codes 32..126 from the standard AFM files. */
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

type FontKey = "F1" | "F2" | "F3";

function charWidth(font: FontKey, code: number): number {
  if (font === "F3") return 600;
  const table = font === "F2" ? HELVETICA_BOLD : HELVETICA;
  if (code >= 32 && code <= 126) return table[code - 32] ?? 556;
  if (code === 0x85 || code === 0x97) return 1000;
  return 600; // Latin-1 letters and the rest: a safe upper bound for wrapping
}

function textWidth(font: FontKey, size: number, winAnsi: string): number {
  let w = 0;
  for (let i = 0; i < winAnsi.length; i++) w += charWidth(font, winAnsi.charCodeAt(i));
  return (w * size) / 1000;
}

/** Greedy word wrap; words longer than the line (URLs, paths) are split by character. */
function wrap(font: FontKey, size: number, winAnsi: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  const push = () => {
    lines.push(current);
    current = "";
  };
  for (const word of winAnsi.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (textWidth(font, size, candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current !== "") push();
    let rest = word;
    while (textWidth(font, size, rest) > maxWidth) {
      let cut = 1;
      while (cut < rest.length && textWidth(font, size, rest.slice(0, cut + 1)) <= maxWidth) cut++;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current !== "" || lines.length === 0) push();
  return lines;
}

// --- layout -------------------------------------------------------------------

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;
const BOTTOM = 60; // room for the footer
const CONTENT_W = PAGE_W - 2 * MARGIN;

type Rgb = [number, number, number];
const INK: Rgb = [0.1, 0.1, 0.12];
const MUTED: Rgb = [0.38, 0.4, 0.45];
const RED: Rgb = [0.75, 0.13, 0.13];
const AMBER: Rgb = [0.7, 0.45, 0.02];
const GREEN: Rgb = [0.1, 0.5, 0.25];
const RULE: Rgb = [0.82, 0.83, 0.86];

const num = (n: number): string => (Math.round(n * 100) / 100).toString();
const rgb = (c: Rgb): string => `${num(c[0])} ${num(c[1])} ${num(c[2])} rg`;

interface TextOptions {
  font?: FontKey;
  size?: number;
  color?: Rgb;
  indent?: number;
  gapAfter?: number;
  /** Cap for sanitize(); report strings are cut here before layout. */
  max?: number;
}

class Layout {
  readonly pages: string[][] = [[]];
  private y = PAGE_H - MARGIN;

  private get ops(): string[] {
    return this.pages[this.pages.length - 1] ?? [];
  }

  private ensure(height: number): void {
    if (this.y - height >= BOTTOM) return;
    this.pages.push([]);
    this.y = PAGE_H - MARGIN;
  }

  text(raw: string, o: TextOptions = {}): void {
    const font = o.font ?? "F1";
    const size = o.size ?? 10;
    const indent = o.indent ?? 0;
    const lead = size * 1.35;
    const lines = wrap(font, size, toWinAnsi(sanitize(raw, o.max ?? 2000)), CONTENT_W - indent);
    for (const l of lines) {
      this.ensure(lead);
      this.y -= lead;
      this.ops.push(`BT ${rgb(o.color ?? INK)} /${font} ${num(size)} Tf ${num(MARGIN + indent)} ${num(this.y + size * 0.3)} Td (${escapePdfString(l)}) Tj ET`);
    }
    this.y -= o.gapAfter ?? 0;
  }

  /** Several runs on one line (short labels only; no wrapping). */
  runs(parts: { text: string; font?: FontKey; size?: number; color?: Rgb }[], gapAfter = 0): void {
    const size = Math.max(...parts.map((p) => p.size ?? 10));
    const lead = size * 1.35;
    this.ensure(lead);
    this.y -= lead;
    let x = MARGIN;
    for (const p of parts) {
      const font = p.font ?? "F1";
      const s = p.size ?? 10;
      const t = toWinAnsi(sanitize(p.text, 120));
      this.ops.push(`BT ${rgb(p.color ?? INK)} /${font} ${num(s)} Tf ${num(x)} ${num(this.y + size * 0.3)} Td (${escapePdfString(t)}) Tj ET`);
      x += textWidth(font, s, t);
    }
    this.y -= gapAfter;
  }

  rule(gapBefore = 6, gapAfter = 8): void {
    this.ensure(gapBefore + gapAfter + 1);
    this.y -= gapBefore;
    this.ops.push(`${num(RULE[0])} ${num(RULE[1])} ${num(RULE[2])} RG 0.6 w ${num(MARGIN)} ${num(this.y)} m ${num(PAGE_W - MARGIN)} ${num(this.y)} l S`);
    this.y -= gapAfter;
  }

  space(h: number): void {
    this.y -= h;
  }

  /** Keeps a block's first lines together with its heading. */
  keep(height: number): void {
    this.ensure(height);
  }
}

// --- report content -----------------------------------------------------------

function verdictWord(v: string): string {
  return v === "pass" ? "PASS" : v === "fail" ? "FAIL" : "INCOMPLETE";
}

function verdictColor(v: string): Rgb {
  return v === "pass" ? GREEN : v === "fail" ? RED : AMBER;
}

function kindLabel(f: Finding): string {
  return f.evidence.kind === "insecure-pattern" ? "code pattern" : f.evidence.kind === "supply-chain-anomaly" ? "supply chain" : "dependency";
}

function findingTitle(f: Finding): string {
  const e = f.evidence;
  if (e.kind === "insecure-pattern") return `${e.ruleId}: ${e.title}`;
  if (e.kind === "supply-chain-anomaly") return `${e.origin === "advisory" ? e.advisoryId ?? "" : e.ruleId ?? ""}: ${e.type}`;
  return `${e.vulnerabilityId}${e.aliases[0] ? ` (${e.aliases[0]})` : ""}: ${e.summary ?? ""}`;
}

function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function ordered(findings: Finding[]): Finding[] {
  const sev = (f: Finding) => SEVERITY_RANK[f.severity.tier.toUpperCase()] ?? 9;
  return [...findings].sort((a, b) => a.priority.localeCompare(b.priority) || sev(a) - sev(b));
}

function writeFinding(doc: Layout, f: Finding): void {
  const e = f.evidence;
  doc.keep(70);
  doc.rule(4, 2);
  doc.runs([
    { text: `${f.priority} · ${PRIORITY_LABEL[f.priority] ?? ""}`, font: "F2", size: 9, color: f.priority === "P1" ? RED : f.priority === "P2" ? AMBER : MUTED },
    { text: `   ${f.severity.tier} · ${kindLabel(f)} · ${f.source.name}`, size: 9, color: MUTED },
  ]);
  doc.text(findingTitle(f), { font: "F2", size: 10.5, max: 300 });
  doc.text(f.subject, { font: "F3", size: 8.5, color: MUTED, max: 300 });
  doc.text(f.remediation.action, { size: 9.5, max: 600, gapAfter: 2 });

  if (e.kind === "insecure-pattern") {
    doc.text(`${e.file}:${String(e.line)} · classified as ${e.fileClass}`, { font: "F3", size: 8.5, color: MUTED, max: 300 });
    doc.text(e.snippet, { font: "F3", size: 8.5, indent: 8, max: 600 });
    doc.text(e.message, { size: 9.5, max: 800 });
  } else if (e.kind === "supply-chain-anomaly") {
    doc.text(e.summary, { size: 9.5, max: 800 });
    for (const i of e.indicators.slice(0, 12)) doc.text(`• ${i}`, { font: "F3", size: 8.5, indent: 8, max: 300 });
    doc.text(`Verification: ${e.verification}${e.reviewedBy ? ` · reviewed by ${e.reviewedBy}` : ""}`, { size: 9, color: MUTED, max: 300 });
  } else {
    if (e.details) doc.text(e.details.length > 1200 ? `${e.details.slice(0, 1200)}…` : e.details, { size: 9, color: MUTED, max: 1300 });
    const fixed = f.remediation.fixedVersions.length > 0 ? `fixed in ${f.remediation.fixedVersions.join(", ")}` : "no fixed version published";
    doc.text(`Published ${e.published ?? "unknown"} · source ${f.source.name} · ${fixed}`, { size: 9, color: MUTED, max: 400 });
  }
  doc.text(`Why this priority: ${f.rationale.join(" -> ")}`, { size: 8.5, color: MUTED, max: 600 });
  for (const r of f.references.slice(0, 6)) {
    const url = safeUrl(r.url);
    doc.text(url ? `${r.type}: ${url}` : r.type, { size: 8.5, color: MUTED, max: 400 });
  }
  doc.space(4);
}

function layoutReport(report: PdfReport, meta: PdfMeta): Layout {
  const doc = new Layout();
  const v = report.gate.verdict;

  doc.runs([{ text: "Gateseeker", font: "F2", size: 16 }, { text: "   report", size: 16, color: MUTED }]);
  doc.text(meta.subject, { font: "F3", size: 10, max: 200 });
  doc.text(`Exported ${meta.exportedAt.toISOString().replace("T", " ").slice(0, 16)} UTC · Gateseeker ${report.gateseekerVersion}`, { size: 8.5, color: MUTED, gapAfter: 4 });
  doc.rule(2, 6);

  doc.runs([{ text: verdictWord(v), font: "F2", size: 14, color: verdictColor(v) }], 2);
  doc.text(report.gate.reason, { size: 10, max: 800, gapAfter: 2 });
  const s = report.summary;
  doc.text(
    report.analyses.dependencies === "analyzed"
      ? `Queried ${String(s.queried)} dependency version(s): ${String(s.byQueryState.vulnerable)} with known issues, ${String(s.byQueryState["no-known-vulnerabilities"])} without, ${String(s.byQueryState["query-failed"])} failed, ${String(s.byQueryState["not-queried"])} not queried.`
      : "Dependencies were not analyzed: no supported lockfile at the repository root.",
    { size: 9, color: MUTED },
  );
  if (report.analyses.patterns === "analyzed" && report.patterns) doc.text(`${String(report.patterns.filesScanned)} file(s) scanned for code patterns.`, { size: 9, color: MUTED });
  const g = report.gate;
  doc.text([`Gate: fail on ${g.failOn}, patterns ${g.patternsMode}, supply-chain rules ${g.supplyChainMode}`, ...(meta.notes ?? []), `sources: ${report.sources.map((x) => x.name).join(", ") || "none"}`].join(" · "), { size: 8.5, color: MUTED, max: 800, gapAfter: 6 });

  doc.runs(
    (["P1", "P2", "P3", "P4"] as const).map((p) => ({ text: `${p} ${PRIORITY_LABEL[p] ?? ""}: ${String(s.byPriority[p])}     `, font: "F2" as const, size: 9.5, color: p === "P1" && s.byPriority[p] > 0 ? RED : INK })),
    4,
  );

  doc.text(`Findings (${String(report.findings.length)})`, { font: "F2", size: 12, gapAfter: 2 });
  if (report.findings.length === 0) doc.text("No known vulnerabilities or insecure patterns were found in the sources consulted.", { size: 10 });
  for (const f of ordered(report.findings)) writeFinding(doc, f);

  if (report.errors.length > 0) {
    doc.keep(40);
    doc.text(`Errors and warnings (${String(report.errors.length)})`, { font: "F2", size: 11, gapAfter: 2 });
    for (const e of report.errors) doc.text(`• ${e}`, { size: 9, color: MUTED, indent: 6, max: 600 });
    doc.space(6);
  }
  doc.keep(40);
  doc.text("Limitations", { font: "F2", size: 11, gapAfter: 2 });
  for (const l of report.limitations) doc.text(`• ${l}`, { size: 9, color: MUTED, indent: 6, max: 600 });
  doc.space(8);
  doc.text('"No known vulnerabilities" means none was returned by the sources consulted at query time, not that a project is secure.', { size: 8.5, color: MUTED });
  return doc;
}

// --- file ---------------------------------------------------------------------

/** Renders the report as a PDF file. Deterministic for the same input and `exportedAt`. */
export function renderPdf(report: PdfReport, meta: PdfMeta): Uint8Array<ArrayBuffer> {
  const doc = layoutReport(report, meta);
  const total = doc.pages.length;
  const footer = toWinAnsi(sanitize(meta.subject, 120));

  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(""); // filled once the pages object id is known
  const pagesId = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  doc.pages.forEach((ops, i) => {
    const foot = [
      `BT ${rgb(MUTED)} /F1 8 Tf ${num(MARGIN)} 32 Td (${escapePdfString(footer)}) Tj ET`,
      `BT ${rgb(MUTED)} /F1 8 Tf ${num(PAGE_W - MARGIN - 60)} 32 Td (Page ${String(i + 1)} of ${String(total)}) Tj ET`,
    ];
    const stream = [...ops, ...foot].join("\n");
    const content = add(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${String(pagesId)} 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] /Resources << /Font << /F1 ${String(f1)} 0 R /F2 ${String(f2)} 0 R /F3 ${String(f3)} 0 R >> >> /Contents ${String(content)} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${String(pagesId)} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${String(k)} 0 R`).join(" ")}] /Count ${String(kids.length)} >>`;
  const info = add(`<< /Title (${escapePdfString(toWinAnsi(sanitize(`Gateseeker report ${meta.subject}`, 200)))}) /Producer (Gateseeker ${escapePdfString(toWinAnsi(sanitize(report.gateseekerVersion, 40)))}) >>`);

  // Every character is below 256, so string length equals byte length for the xref offsets.
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root ${String(catalog)} 0 R /Info ${String(info)} 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

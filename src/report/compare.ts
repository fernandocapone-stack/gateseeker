import type { Finding, Report } from "../types.js";

/**
 * Compares two reports of the same repository (docs/SPRINT_6.md 3.2): every
 * finding of the newer one is "new" or "still open", and every finding of the
 * older one that is gone is "fixed", or "unverified" when the newer scan could
 * not have seen it. Browser- and Node-safe (no Node imports), so the web, the
 * CLI and the Action can share it.
 *
 * The comparison key never uses a line number, which changes with every edit:
 *   dependency     vulnerability id + package name (an upgrade that is still
 *                  vulnerable stays "still open", not new)
 *   code pattern   rule + file + a hash of the redacted snippet
 *   supply chain   advisory id or rule + package name
 * Equal keys are matched one to one, so two identical findings in one file
 * count as two.
 */

export type ComparedReport = Pick<Report, "findings" | "analyses" | "gate">;

export interface Comparison {
  newFindings: Finding[];
  stillOpen: Finding[];
  fixed: Finding[];
  /** Gone from the newer report, but the newer scan could not have checked them (incomplete, or that analysis did not run). */
  unverified: Finding[];
}

/** FNV-1a, 32 bits: a short, stable fingerprint of a redacted snippet (never the text itself). */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function packageName(subject: string): string {
  const at = subject.lastIndexOf("@");
  return at > 0 ? subject.slice(0, at) : subject;
}

export function comparisonKey(f: Finding): string {
  const e = f.evidence;
  if (e.kind === "dependency-vulnerability") return `dep|${e.vulnerabilityId}|${packageName(f.subject)}`;
  if (e.kind === "insecure-pattern") return `pat|${e.ruleId}|${e.file}|${fingerprint(e.snippet.trim())}`;
  if (e.kind === "supply-chain-anomaly") return `sc|${e.advisoryId ?? e.ruleId ?? e.type}|${packageName(f.subject)}`;
  return `other|${f.id}`;
}

/** Whether the newer report could have seen this older finding again. */
function couldHaveSeen(f: Finding, newer: ComparedReport): boolean {
  if (f.evidence.kind === "insecure-pattern") return newer.analyses.patterns === "analyzed";
  // Dependency and supply-chain findings need a complete dependency analysis: an incomplete one may have skipped exactly this package.
  return newer.analyses.dependencies === "analyzed" && newer.gate.verdict !== "incomplete";
}

export function compareReports(older: ComparedReport, newer: ComparedReport): Comparison {
  const remaining = new Map<string, Finding[]>();
  for (const f of older.findings) {
    const k = comparisonKey(f);
    const list = remaining.get(k);
    if (list) list.push(f);
    else remaining.set(k, [f]);
  }
  const newFindings: Finding[] = [];
  const stillOpen: Finding[] = [];
  for (const f of newer.findings) {
    const list = remaining.get(comparisonKey(f));
    if (list && list.length > 0) {
      list.shift();
      stillOpen.push(f);
    } else {
      newFindings.push(f);
    }
  }
  const fixed: Finding[] = [];
  const unverified: Finding[] = [];
  for (const list of remaining.values()) for (const f of list) (couldHaveSeen(f, newer) ? fixed : unverified).push(f);
  return { newFindings, stillOpen, fixed, unverified };
}

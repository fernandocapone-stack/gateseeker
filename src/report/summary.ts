import type { Finding, Report } from "../types.js";
import { sanitize } from "./text.js";

/**
 * Short Markdown for the GitHub job summary and the sticky PR comment.
 * Untrusted strings are sanitized and Markdown-escaped; no links are built
 * from project data.
 */

export const SUMMARY_MARKER = "<!-- gateseeker-summary -->";
const MAX_ROWS = 20;

function md(text: string, max = 120): string {
  return sanitize(text, max).replace(/[|\\`*_[\]<>]/g, (c) => `\\${c}`);
}

function describe(f: Finding): string {
  const e = f.evidence;
  if (e.kind === "insecure-pattern") return `${e.ruleId}: ${e.title}`;
  if (e.kind === "supply-chain-anomaly") return `${e.origin === "advisory" ? e.advisoryId : e.ruleId}: ${e.type}`;
  return `${e.vulnerabilityId}${e.aliases[0] ? ` (${e.aliases[0]})` : ""}: ${e.summary ?? ""}`;
}

export function renderSummary(report: Report): string {
  const s = report.summary;
  const verdictIcon = report.gate.verdict === "pass" ? "✅" : report.gate.verdict === "fail" ? "❌" : "⚠️";
  const lines: string[] = [SUMMARY_MARKER, `### ${verdictIcon} Gateseeker: ${report.gate.verdict.toUpperCase()}`, ""];
  lines.push(md(report.gate.reason, 300), "");
  lines.push(`| | P1 | P2 | P3 | P4 | Total |`, `|---|---|---|---|---|---|`);
  lines.push(`| Findings | ${s.byPriority.P1} | ${s.byPriority.P2} | ${s.byPriority.P3} | ${s.byPriority.P4} | ${report.findings.length} |`);
  lines.push("");
  lines.push(`Dependencies ${s.byKind["dependency-vulnerability"]} · supply chain ${s.byKind["supply-chain-anomaly"]} · code patterns ${s.byKind["insecure-pattern"]} · gate: fail-on ${report.gate.failOn}, patterns ${report.gate.patternsMode}, supply-chain rules ${report.gate.supplyChainMode}`);
  if (report.analyses.dependencies === "analyzed") {
    lines.push(`Queried ${s.queried} dependency version(s): ${s.byQueryState.vulnerable} with known issues, ${s.byQueryState["no-known-vulnerabilities"]} without, ${s.byQueryState["query-failed"]} failed, ${s.byQueryState["not-queried"]} not queried.`);
  } else if (report.analyses.dependencies === "not-supported") {
    lines.push(`Dependencies were not analyzed: ${md((report.project.unsupportedLockfiles ?? []).join(", "), 120)} is not supported yet, so the gate is incomplete.`);
  } else {
    lines.push("Dependencies were not analyzed (no lockfile at the project root, or `only: patterns`).");
  }
  if (report.baseline) {
    lines.push(`Baseline: ${report.baseline.packagesCompared} package(s) compared, ${report.baseline.added.length} added, ${report.baseline.removed.length} removed, ${report.baseline.changed.length} changed.`);
  }
  lines.push("");

  if (report.findings.length > 0) {
    lines.push(`| Priority | Subject | Finding | Severity | Action |`, `|---|---|---|---|---|`);
    for (const f of report.findings.slice(0, MAX_ROWS)) {
      lines.push(`| ${f.priority} | ${md(f.subject, 80)} | ${md(describe(f), 140)} | ${f.severity.tier} | ${md(f.remediation.action, 200)} |`);
    }
    if (report.findings.length > MAX_ROWS) lines.push("", `… and ${report.findings.length - MAX_ROWS} more in the JSON report.`);
    lines.push("");
  } else {
    lines.push("No known vulnerabilities or insecure patterns were found in the sources consulted.", "");
  }

  if (report.errors.length > 0) {
    lines.push(`<details><summary>Errors and warnings (${report.errors.length})</summary>`, "");
    for (const e of report.errors.slice(0, 30)) lines.push(`- ${md(e, 200)}`);
    lines.push("", "</details>", "");
  }
  lines.push("<details><summary>Limitations</summary>", "");
  for (const l of report.limitations) lines.push(`- ${md(l, 300)}`);
  lines.push("", "</details>", "");
  lines.push(`<sub>Gateseeker ${md(report.gateseekerVersion, 30)} · run ${md(report.runId, 40)} · sources: ${report.sources.map((x) => md(x.name, 40)).join(", ") || "none"}</sub>`);
  return lines.join("\n");
}

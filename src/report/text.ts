import type { Finding, Report } from "../types.js";

/**
 * Human-readable terminal output. All strings coming from the lockfile, from
 * project files or from OSV are untrusted: control characters are stripped so
 * a crafted package name or summary cannot drive the terminal.
 */

const cc = (code: number): string => String.fromCharCode(code);
// C0 controls except TAB/LF/CR, DEL, C1 controls, and the Unicode line/paragraph separators.
const CONTROL_CHARS = new RegExp(
  `[${cc(0)}-${cc(8)}${cc(11)}-${cc(31)}${cc(127)}-${cc(159)}${cc(0x2028)}${cc(0x2029)}]`,
  "g",
);

export function sanitize(text: string, max = 200): string {
  const clean = text.replace(CONTROL_CHARS, "").replace(/\r?\n|\t/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function line(label: string, value: string): string {
  return `${label.padEnd(14)} ${value}`;
}

function renderDependencyFinding(f: Finding): string[] {
  if (f.evidence.kind !== "dependency-vulnerability") return [];
  const e = f.evidence;
  const alias = e.aliases[0];
  const ids = alias ? `${e.vulnerabilityId} (${sanitize(alias, 40)})` : e.vulnerabilityId;
  const cvss = f.severity.cvss.find((c) => c.score !== null);
  const sev = cvss ? `${f.severity.tier} (CVSS ${cvss.score})` : f.severity.tier;
  const out = [
    `  [${f.priority}] ${sanitize(f.subject, 120)}  ${sanitize(ids, 120)}`,
    `       ${sanitize(e.summary ?? "(no summary provided by source)")}`,
    `       severity: ${sev}   why: ${f.rationale.join(", ")}`,
    `       action:   ${sanitize(f.remediation.action, 300)}`,
  ];
  const ref = f.references.find((r) => r.type === "ADVISORY") ?? f.references[0];
  if (ref) out.push(`       ref:      ${sanitize(ref.url, 200)}`);
  return out;
}

function renderPatternFinding(f: Finding): string[] {
  if (f.evidence.kind !== "insecure-pattern") return [];
  const e = f.evidence;
  const out = [
    `  [${f.priority}] ${sanitize(f.subject, 160)}  ${sanitize(e.ruleId, 40)}  ${sanitize(e.title, 100)}`,
    `       ${sanitize(e.message, 300)}`,
  ];
  if (e.snippet.length > 0) out.push(`       code:     ${sanitize(e.snippet, 160)}`);
  out.push(`       severity: ${f.severity.tier} (${sanitize(e.fileClass, 20)} file)   why: ${f.rationale.join(", ")}`);
  out.push(`       action:   ${sanitize(f.remediation.action, 300)}`);
  return out;
}

function renderAdvisoryFinding(f: Finding): string[] {
  if (f.evidence.kind !== "supply-chain-anomaly") return [];
  const e = f.evidence;
  const label = e.origin === "advisory" ? sanitize(e.advisoryId ?? "", 40) : sanitize(e.ruleId ?? "", 40);
  const out = [
    `  [${f.priority}] ${sanitize(f.subject, 120)}  ${label}  supply-chain: ${sanitize(e.type, 80)}`,
    `       ${sanitize(e.summary, 400)}`,
    `       severity: ${f.severity.tier}   why: ${f.rationale.join(", ")}${e.verification === "unverified" ? "   (unverified: registry check unavailable)" : ""}`,
    `       action:   ${sanitize(f.remediation.action, 500)}`,
  ];
  if (e.indicators.length > 0) out.push(`       evidence: ${sanitize(e.indicators.join("; "), 300)}`);
  const ref = f.references[0];
  if (ref) out.push(`       ref:      ${sanitize(ref.url, 200)}`);
  if (e.reviewedBy) out.push(`       reviewed: ${sanitize(e.reviewedBy, 60)} on ${sanitize(e.reviewedAt ?? "?", 30)}`);
  return out;
}

function renderFinding(f: Finding): string[] {
  switch (f.evidence.kind) {
    case "insecure-pattern":
      return renderPatternFinding(f);
    case "supply-chain-anomaly":
      return renderAdvisoryFinding(f);
    default:
      return renderDependencyFinding(f);
  }
}

export function renderText(report: Report): string {
  const s = report.summary;
  const out: string[] = [];
  out.push(`gateseeker ${report.gateseekerVersion}  run ${report.runId}`);
  out.push(line("project", sanitize(report.project.rootPath)));
  if (report.analyses.dependencies === "analyzed") {
    for (const lf of report.project.lockfiles) {
      out.push(line("lockfile", `${sanitize(lf.path)}${lf.lockfileVersion !== null ? ` (v${lf.lockfileVersion})` : ""}`));
    }
    if (report.baseline) {
      const b = report.baseline;
      out.push(line("baseline", `${sanitize(b.path)}  compared ${b.packagesCompared}, added ${b.added.length}, removed ${b.removed.length}, changed ${b.changed.length}`));
    }
    out.push(
      line(
        "dependencies",
        `${s.dependencies} unique  (queried ${s.queried}, not queried ${s.byQueryState["not-queried"]}, failed ${s.byQueryState["query-failed"]})`,
      ),
    );
  } else {
    out.push(line("dependencies", "not analyzed (no package-lock.json at root, or --only patterns)"));
  }
  if (report.patterns) {
    const p = report.patterns;
    out.push(line("code", `${p.filesScanned} files scanned, ${p.filesSkippedIgnored} ignored, ${p.filesSkippedBinary} binary; ${p.rulesRun.length} rules; mode ${report.gate.patternsMode}`));
  } else {
    out.push(line("code", "not analyzed (lockfile-only scan, or --only deps)"));
  }
  out.push(line("sources", report.sources.map((x) => x.name).join(", ") || "none"));
  out.push("");

  if (report.findings.length === 0) {
    out.push("No known vulnerabilities or insecure patterns were found in the sources consulted.");
  } else {
    out.push(
      `Findings: ${report.findings.length}  (P1 ${s.byPriority.P1}, P2 ${s.byPriority.P2}, P3 ${s.byPriority.P3}, P4 ${s.byPriority.P4})  dependencies ${s.byKind["dependency-vulnerability"]}, supply-chain advisories ${s.byKind["supply-chain-anomaly"]}, code patterns ${s.byKind["insecure-pattern"]}`,
    );
    for (const f of report.findings) {
      out.push(...renderFinding(f));
      out.push("");
    }
  }

  if (report.patterns && report.patterns.suppressions.length > 0) {
    out.push(`Suppressed (${report.patterns.suppressions.length}):`);
    for (const sup of report.patterns.suppressions) out.push(`  - ${sanitize(`${sup.file}:${sup.line} ${sup.ruleId}: ${sup.reason}`, 200)}`);
    out.push("");
  }

  if (report.errors.length > 0) {
    out.push(`Errors and warnings (${report.errors.length}):`);
    for (const e of report.errors) out.push(`  - ${sanitize(e, 300)}`);
    out.push("");
  }

  out.push(`GATE: ${report.gate.verdict.toUpperCase()} (fail-on ${report.gate.failOn}, patterns ${report.gate.patternsMode}, supply-chain rules ${report.gate.supplyChainMode})`);
  out.push(`  ${report.gate.reason}`);
  return out.join("\n");
}

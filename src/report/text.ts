import type { Finding, Report } from "../types.js";

/**
 * Human-readable terminal output. All strings coming from the lockfile or
 * from OSV are untrusted: control characters are stripped so a crafted
 * package name or summary cannot drive the terminal.
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

function renderFinding(f: Finding): string[] {
  const alias = f.evidence.aliases[0];
  const ids = alias ? `${f.evidence.vulnerabilityId} (${sanitize(alias, 40)})` : f.evidence.vulnerabilityId;
  const cvss = f.severity.cvss.find((c) => c.score !== null);
  const sev = cvss ? `${f.severity.tier} (CVSS ${cvss.score})` : f.severity.tier;
  const out = [
    `  [${f.priority}] ${sanitize(f.subject, 120)}  ${sanitize(ids, 120)}`,
    `       ${sanitize(f.evidence.summary ?? "(no summary provided by source)")}`,
    `       severity: ${sev}   why: ${f.rationale.join(", ")}`,
    `       action:   ${sanitize(f.remediation.action, 300)}`,
  ];
  const ref = f.references.find((r) => r.type === "ADVISORY") ?? f.references[0];
  if (ref) out.push(`       ref:      ${sanitize(ref.url, 200)}`);
  return out;
}

export function renderText(report: Report): string {
  const s = report.summary;
  const out: string[] = [];
  out.push(`gateseeker ${report.gateseekerVersion}  run ${report.runId}`);
  out.push(line("lockfile", `${sanitize(report.project.lockfilePath)} (v${report.project.lockfileVersion})`));
  out.push(
    line(
      "dependencies",
      `${s.dependencies} unique  (queried ${s.queried}, not queried ${s.byQueryState["not-queried"]}, failed ${s.byQueryState["query-failed"]})`,
    ),
  );
  out.push(line("source", report.sources.map((x) => x.name).join(", ")));
  out.push("");

  if (report.findings.length === 0) {
    out.push("No known vulnerabilities were found in the sources consulted.");
  } else {
    out.push(
      `Findings: ${report.findings.length}  (P1 ${s.byPriority.P1}, P2 ${s.byPriority.P2}, P3 ${s.byPriority.P3}, P4 ${s.byPriority.P4})`,
    );
    for (const f of report.findings) {
      out.push(...renderFinding(f));
      out.push("");
    }
  }

  if (report.errors.length > 0) {
    out.push(`Errors and warnings (${report.errors.length}):`);
    for (const e of report.errors) out.push(`  - ${sanitize(e, 300)}`);
    out.push("");
  }

  out.push(`GATE: ${report.gate.verdict.toUpperCase()} (fail-on ${report.gate.failOn})`);
  out.push(`  ${report.gate.reason}`);
  return out.join("\n");
}

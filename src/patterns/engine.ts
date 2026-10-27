import { sanitize } from "../report/text.js";
import { decidePriority } from "../rules/priority.js";
import type { Finding } from "../types.js";
import type { FileClass, PatternsSummary, ProjectSnapshot, Rule, RuleMatch, Suppression } from "./types.js";

/**
 * Runs rules over a project snapshot, applies inline suppressions and turns
 * matches into Findings using the same priority table as dependency findings.
 */

export const PATTERN_SOURCE_NAME = "gateseeker-rules";

const SUPPRESS_RE = /gateseeker-ignore\s+(GSK-[A-Z]+-\d{3})(?:\s+(.*))?$/;

interface SuppressionLookup {
  active: Map<string, Suppression>; // key: `${file}:${line}:${ruleId}`
  invalid: { file: string; line: number; text: string }[];
}

function collectSuppressions(project: ProjectSnapshot): SuppressionLookup {
  const active = new Map<string, Suppression>();
  const invalid: SuppressionLookup["invalid"] = [];
  for (const file of project.files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      const m = SUPPRESS_RE.exec(line);
      if (!m) continue;
      const ruleId = m[1] ?? "";
      const reason = (m[2] ?? "").replace(/\*\/\s*$/, "").replace(/-->\s*$/, "").trim();
      const lineNo = i + 1;
      if (reason.length === 0) {
        invalid.push({ file: file.path, line: lineNo, text: sanitize(line.trim(), 120) });
        continue;
      }
      const s: Suppression = { file: file.path, line: lineNo, ruleId, reason: sanitize(reason, 200) };
      // A suppression covers its own line and the next one.
      active.set(`${file.path}:${lineNo}:${ruleId}`, s);
      active.set(`${file.path}:${lineNo + 1}:${ruleId}`, s);
    }
  }
  return { active, invalid };
}

export interface PatternRunResult {
  findings: Finding[];
  summary: PatternsSummary;
}

export function runRules(project: ProjectSnapshot, rules: Rule[], now: () => Date): PatternRunResult {
  const queriedAt = now().toISOString();
  const suppressions = collectSuppressions(project);
  const used = new Map<string, Suppression>();
  const findings: Finding[] = [];

  for (const rule of rules) {
    for (const file of project.files) {
      if (!rule.appliesTo(file, project)) continue;
      let matches: RuleMatch[];
      try {
        matches = rule.check({ file, project });
      } catch (err) {
        // A rule bug must never crash a scan or hide other findings.
        matches = [];
        findings.push(ruleErrorFinding(rule, file.path, err, queriedAt));
      }
      for (const m of matches) {
        const key = `${file.path}:${m.line}:${rule.id}`;
        const sup = suppressions.active.get(key);
        if (sup) {
          used.set(`${sup.file}:${sup.line}:${sup.ruleId}`, sup);
          continue;
        }
        findings.push(toFinding(rule, file.path, file.fileClass, m, queriedAt));
      }
    }
  }

  findings.sort((a, b) => (a.priority === b.priority ? a.subject.localeCompare(b.subject) : a.priority.localeCompare(b.priority)));

  return {
    findings,
    summary: {
      filesScanned: project.stats.filesScanned,
      filesSkippedIgnored: project.stats.filesSkippedIgnored,
      filesSkippedBinary: project.stats.filesSkippedBinary,
      bytesScanned: project.stats.bytesScanned,
      rulesRun: rules.map((r) => r.id),
      suppressions: [...used.values()],
      invalidSuppressions: suppressions.invalid,
    },
  };
}

function toFinding(rule: Rule, path: string, fileClass: FileClass, m: RuleMatch, queriedAt: string): Finding {
  const severity = m.severity ?? rule.severity;
  const exposure = { direct: true, production: fileClass !== "test" };
  const decision = decidePriority({ severity, exposure, fixAvailable: true });
  decision.rationale.unshift(`rule:${rule.id}`);
  const subject = `${path}:${m.line}`;
  return {
    id: `${rule.id}::${subject}`,
    kind: "insecure-pattern",
    subject,
    evidence: {
      kind: "insecure-pattern",
      ruleId: rule.id,
      title: rule.title,
      file: path,
      line: m.line,
      fileClass,
      snippet: m.snippet,
      message: sanitize(m.message, 300),
      details: m.details ?? null,
    },
    source: { name: PATTERN_SOURCE_NAME, queriedAt },
    severity: { tier: severity, declared: null, cvss: [] },
    priority: decision.priority,
    rationale: decision.rationale,
    remediation: { fixedVersions: [], action: m.action ?? rule.action },
    references: [],
    aiExplanation: null,
  };
}

function ruleErrorFinding(rule: Rule, path: string, err: unknown, queriedAt: string): Finding {
  const message = `Rule ${rule.id} failed on ${path}: ${err instanceof Error ? err.message : String(err)}`;
  return {
    id: `GSK-ENGINE-000::${path}`,
    kind: "insecure-pattern",
    subject: `${path}:0`,
    evidence: {
      kind: "insecure-pattern",
      ruleId: "GSK-ENGINE-000",
      title: "Rule execution error",
      file: path,
      line: 0,
      fileClass: "other",
      snippet: "",
      message: sanitize(message, 300),
      details: { failedRule: rule.id },
    },
    source: { name: PATTERN_SOURCE_NAME, queriedAt },
    severity: { tier: "UNKNOWN", declared: null, cvss: [] },
    priority: "P4",
    rationale: ["rule-error"],
    remediation: { fixedVersions: [], action: "Report this to the Gateseeker maintainers; the file was not fully analyzed by this rule." },
    references: [],
    aiExplanation: null,
  };
}

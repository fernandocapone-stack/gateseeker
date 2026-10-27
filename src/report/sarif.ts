import { createHash } from "node:crypto";
import { relative } from "node:path";
import type { Finding, Priority, Report } from "../types.js";
import { sanitize } from "./text.js";

/**
 * SARIF 2.1.0 output for GitHub code scanning and other consumers.
 * One run, one tool, one result per finding. Levels follow priority
 * (P1/P2 error, P3 warning, P4 note). Fingerprints are stable across runs
 * for the same finding id so GitHub can track open/fixed state.
 */

const SARIF_SCHEMA = "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json";
const README = "https://github.com/fernandocapone-stack/gateseeker#readme";

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri: string;
  properties: { kind: string; tags: string[] };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: { physicalLocation: { artifactLocation: { uri: string; uriBaseId: string }; region?: { startLine: number } } }[];
  partialFingerprints: { "gateseeker/finding/v1": string };
  properties: { priority: Priority; severity: string; kind: string; rationale: string[]; subject: string };
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: {
    tool: { driver: { name: string; version: string; informationUri: string; rules: SarifRule[] } };
    originalUriBaseIds: { PROJECT: { uri: string } };
    results: SarifResult[];
    invocations: { executionSuccessful: boolean; properties: { verdict: string; reason: string; analyses: Report["analyses"] } }[];
  }[];
}

export function levelFor(priority: Priority): SarifResult["level"] {
  return priority === "P1" || priority === "P2" ? "error" : priority === "P3" ? "warning" : "note";
}

function toUri(path: string, root: string): string {
  const rel = relative(root, path).split("\\").join("/");
  return rel.startsWith("..") || rel === "" ? path.split("\\").join("/") : rel;
}

function ruleFor(f: Finding, lockfileUri: string | null): { rule: SarifRule; uri: string; line: number | null } {
  const e = f.evidence;
  if (e.kind === "insecure-pattern") {
    return {
      rule: {
        id: e.ruleId,
        name: e.ruleId.replace(/-/g, ""),
        shortDescription: { text: sanitize(e.title, 120) },
        fullDescription: { text: sanitize(e.title, 300) },
        helpUri: README,
        properties: { kind: "insecure-pattern", tags: ["security", "gateseeker"] },
      },
      uri: e.file,
      line: e.line > 0 ? e.line : null,
    };
  }
  if (e.kind === "supply-chain-anomaly") {
    const id = e.origin === "advisory" ? (e.advisoryId ?? "GSK-ADV") : (e.ruleId ?? "GSK-SC");
    return {
      rule: {
        id,
        name: id.replace(/-/g, ""),
        shortDescription: { text: sanitize(e.type, 120) },
        fullDescription: { text: sanitize(e.summary, 300) },
        helpUri: e.origin === "advisory" ? `https://github.com/fernandocapone-stack/gateseeker/tree/main/advisories` : README,
        properties: { kind: "supply-chain-anomaly", tags: ["security", "supply-chain", "gateseeker"] },
      },
      uri: lockfileUri ?? "package-lock.json",
      line: null,
    };
  }
  return {
    rule: {
      id: e.vulnerabilityId,
      name: e.vulnerabilityId.replace(/[^A-Za-z0-9]/g, ""),
      shortDescription: { text: sanitize(e.summary ?? e.vulnerabilityId, 120) },
      fullDescription: { text: sanitize(e.summary ?? e.vulnerabilityId, 300) },
      helpUri: f.references.find((r) => r.type === "ADVISORY")?.url ?? `https://osv.dev/vulnerability/${encodeURIComponent(e.vulnerabilityId)}`,
      properties: { kind: "dependency-vulnerability", tags: ["security", "dependency", "gateseeker"] },
    },
    uri: lockfileUri ?? "package-lock.json",
    line: null,
  };
}

export function renderSarif(report: Report): SarifLog {
  const root = report.project.rootPath;
  const rules = new Map<string, SarifRule>();
  const results: SarifResult[] = [];
  const firstLock = report.project.lockfiles[0]?.path ?? null;
  const lockUri = firstLock ? toUri(firstLock, root) : null;

  for (const f of report.findings) {
    const { rule, uri, line } = ruleFor(f, lockUri);
    if (!rules.has(rule.id)) rules.set(rule.id, rule);
    const action = sanitize(f.remediation.action, 400);
    const summary =
      f.evidence.kind === "dependency-vulnerability" ? sanitize(f.evidence.summary ?? "", 200) : f.evidence.kind === "insecure-pattern" ? sanitize(f.evidence.message, 300) : sanitize(f.evidence.summary, 300);
    const text = `[${f.priority}] ${sanitize(f.subject, 120)}: ${summary}${summary.endsWith(".") ? "" : "."} Action: ${action}`;
    results.push({
      ruleId: rule.id,
      level: levelFor(f.priority),
      message: { text },
      locations: [{ physicalLocation: { artifactLocation: { uri: uri.split("\\").join("/"), uriBaseId: "PROJECT" }, ...(line !== null ? { region: { startLine: line } } : {}) } }],
      partialFingerprints: { "gateseeker/finding/v1": createHash("sha256").update(f.id).digest("hex").slice(0, 32) },
      properties: { priority: f.priority, severity: f.severity.tier, kind: f.kind, rationale: f.rationale, subject: f.subject },
    });
  }

  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "Gateseeker", version: report.gateseekerVersion, informationUri: README, rules: [...rules.values()] } },
        originalUriBaseIds: { PROJECT: { uri: `file:///${root.split("\\").join("/").replace(/^\//, "")}/` } },
        results,
        invocations: [{ executionSuccessful: true, properties: { verdict: report.gate.verdict, reason: report.gate.reason, analyses: report.analyses } }],
      },
    ],
  };
}

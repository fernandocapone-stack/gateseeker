import type { OsvVulnerability } from "../intel/osv-schema.js";
import type { CvssEntry, Severity, SeverityTier } from "../types.js";
import { cvss3BaseScore, cvss3Tier } from "./cvss.js";

/**
 * Derives a severity tier from an OSV record, deterministically:
 *   1. the highest locally computed CVSS 3.x base score, when any vector parses;
 *   2. otherwise the qualitative severity declared by the source
 *      (`database_specific.severity`, used by GitHub Advisories), normalised;
 *   3. otherwise UNKNOWN. Unknown is never treated as low.
 */

const DECLARED_TO_TIER: Record<string, SeverityTier> = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MODERATE: "MODERATE",
  MEDIUM: "MODERATE",
  LOW: "LOW",
};

export function deriveSeverity(vuln: OsvVulnerability): Severity {
  const cvss: CvssEntry[] = (vuln.severity ?? []).map((s) => ({
    type: s.type,
    vector: s.score,
    score: s.type === "CVSS_V3" ? cvss3BaseScore(s.score) : null,
  }));

  const declared = vuln.database_specific?.severity ?? null;

  const scored = cvss.map((c) => c.score).filter((s): s is number => s !== null);
  let tier: SeverityTier;
  if (scored.length > 0) {
    const t = cvss3Tier(Math.max(...scored));
    tier = t === "NONE" ? "LOW" : t;
  } else if (declared !== null && DECLARED_TO_TIER[declared.toUpperCase()] !== undefined) {
    tier = DECLARED_TO_TIER[declared.toUpperCase()] ?? "UNKNOWN";
  } else {
    tier = "UNKNOWN";
  }

  return { tier, declared, cvss };
}

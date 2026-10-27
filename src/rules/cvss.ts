/**
 * CVSS v3.0 / v3.1 base score calculator.
 * Specification: https://www.first.org/cvss/v3.1/specification-document (section 7).
 *
 * Only the base metric group is scored. Temporal and environmental metrics are
 * ignored. CVSS v2 and v4 vectors are not scored in this version.
 */

const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 } as const;
const AC = { L: 0.77, H: 0.44 } as const;
const PR_UNCHANGED = { N: 0.85, L: 0.62, H: 0.27 } as const;
const PR_CHANGED = { N: 0.85, L: 0.68, H: 0.5 } as const;
const UI = { N: 0.85, R: 0.62 } as const;
const CIA = { H: 0.56, L: 0.22, N: 0 } as const;

function roundUp(value: number): number {
  // CVSS 3.1 "Roundup" avoiding floating point artefacts.
  const intInput = Math.round(value * 100_000);
  if (intInput % 10_000 === 0) return intInput / 100_000;
  return (Math.floor(intInput / 10_000) + 1) / 10;
}

export function cvss3BaseScore(vector: string): number | null {
  const m = /^CVSS:3\.[01]\/(.+)$/.exec(vector.trim());
  if (!m?.[1]) return null;

  const metrics = new Map<string, string>();
  for (const part of m[1].split("/")) {
    const [k, v] = part.split(":");
    if (!k || v === undefined) return null;
    metrics.set(k, v);
  }

  const av = AV[metrics.get("AV") as keyof typeof AV];
  const ac = AC[metrics.get("AC") as keyof typeof AC];
  const ui = UI[metrics.get("UI") as keyof typeof UI];
  const scope = metrics.get("S");
  const c = CIA[metrics.get("C") as keyof typeof CIA];
  const i = CIA[metrics.get("I") as keyof typeof CIA];
  const a = CIA[metrics.get("A") as keyof typeof CIA];
  const prKey = metrics.get("PR") as keyof typeof PR_UNCHANGED;

  if (
    av === undefined ||
    ac === undefined ||
    ui === undefined ||
    c === undefined ||
    i === undefined ||
    a === undefined ||
    (scope !== "U" && scope !== "C") ||
    !(prKey in PR_UNCHANGED)
  ) {
    return null;
  }

  const changed = scope === "C";
  const pr = changed ? PR_CHANGED[prKey] : PR_UNCHANGED[prKey];

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * av * ac * pr * ui;

  if (impact <= 0) return 0;
  const base = changed
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return roundUp(base);
}

export type QualitativeTier = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "NONE";

/** CVSS v3.x qualitative severity rating scale (specification section 5). */
export function cvss3Tier(score: number): QualitativeTier {
  if (score === 0) return "NONE";
  if (score < 4) return "LOW";
  if (score < 7) return "MODERATE";
  if (score < 9) return "HIGH";
  return "CRITICAL";
}

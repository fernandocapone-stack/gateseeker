import type { Exposure, Priority, SeverityTier } from "../types.js";

/**
 * Deterministic priority rules. The whole policy lives in the two tables
 * below; nothing else in the codebase decides priority.
 *
 * Priority semantics:
 *   P1  act now: production is exposed to a critical or high issue with a fix
 *   P2  fix this sprint
 *   P3  fix when touching the dependency
 *   P4  be aware
 *
 * Every applied rule id is recorded in `Finding.rationale` so a reader can
 * audit how a priority was reached.
 */

export type ExposureClass = "direct-prod" | "transitive-prod" | "dev-only";

export function classifyExposure(exposure: Exposure): ExposureClass {
  if (!exposure.production) return "dev-only";
  return exposure.direct ? "direct-prod" : "transitive-prod";
}

export interface PriorityInput {
  severity: SeverityTier;
  exposure: Exposure;
  fixAvailable: boolean;
}

export interface PriorityDecision {
  priority: Priority;
  rationale: string[];
}

/** Rule table 1: base priority = f(severity tier, exposure class). */
export const BASE_PRIORITY: Record<SeverityTier, Record<ExposureClass, Priority>> = {
  CRITICAL: { "direct-prod": "P1", "transitive-prod": "P1", "dev-only": "P2" },
  HIGH: { "direct-prod": "P1", "transitive-prod": "P2", "dev-only": "P3" },
  MODERATE: { "direct-prod": "P2", "transitive-prod": "P3", "dev-only": "P4" },
  LOW: { "direct-prod": "P3", "transitive-prod": "P4", "dev-only": "P4" },
  // Unknown severity is not low severity: treat as moderate until proven otherwise.
  UNKNOWN: { "direct-prod": "P2", "transitive-prod": "P3", "dev-only": "P4" },
};

/**
 * Rule table 2: modifiers applied in order after the base lookup.
 * Each modifier returns the new priority or null when it does not apply.
 */
export interface Modifier {
  id: string;
  description: string;
  apply: (current: Priority, input: PriorityInput) => Priority | null;
}

const ORDER: Priority[] = ["P1", "P2", "P3", "P4"];

function demote(p: Priority, floor: Priority): Priority {
  const next = ORDER[Math.min(ORDER.indexOf(p) + 1, ORDER.length - 1)] ?? p;
  return ORDER.indexOf(next) > ORDER.indexOf(floor) ? floor : next;
}

export const MODIFIERS: Modifier[] = [
  {
    id: "no-fix-demote",
    description:
      "No fixed version is published: an upgrade cannot be the immediate action, so demote one level. CRITICAL and HIGH never go below P2 because mitigation is still required.",
    apply: (current, input) => {
      if (input.fixAvailable) return null;
      const floor: Priority =
        input.severity === "CRITICAL" || input.severity === "HIGH" ? "P2" : "P4";
      const next = demote(current, floor);
      return next === current ? null : next;
    },
  },
];

export function decidePriority(input: PriorityInput): PriorityDecision {
  const exposureClass = classifyExposure(input.exposure);
  let priority = BASE_PRIORITY[input.severity][exposureClass];
  const rationale = [`base:${input.severity.toLowerCase()}/${exposureClass}=${priority}`];

  for (const modifier of MODIFIERS) {
    const next = modifier.apply(priority, input);
    if (next !== null) {
      rationale.push(`${modifier.id}:${priority}->${next}`);
      priority = next;
    }
  }

  rationale.push(input.fixAvailable ? "fix-available" : "no-fix-available");
  return { priority, rationale };
}

export function priorityAtLeast(p: Priority, threshold: Priority): boolean {
  return ORDER.indexOf(p) <= ORDER.indexOf(threshold);
}

export const PRIORITIES: readonly Priority[] = ORDER;

import type { Priority } from "../types.js";

/**
 * Plain-language names for the priorities, shown next to P1-P4 in the
 * terminal, the Action summary, the PDF and the web report. Wording only:
 * which priority a finding gets is decided by src/rules/priority.ts.
 */
export const PRIORITY_LABEL: Record<Priority, string> = { P1: "Fix now", P2: "Fix before release", P3: "Plan a fix", P4: "Keep an eye on it" };

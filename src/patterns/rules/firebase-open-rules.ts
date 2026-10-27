import { sanitize } from "../../report/text.js";
import type { Rule, RuleMatch } from "../types.js";

/**
 * GSK-FIREBASE-001: Firestore/Storage security rules or Realtime Database
 * rules grant access unconditionally.
 */

const FIRESTORE_ALLOW = /\ballow\s+([a-z,\s]+?)\s*:\s*if\s+true\s*;/g;
const RTDB_OPEN = /"\.(read|write)"\s*:\s*(?:true|"true")/g;

export const firebaseOpenRulesRule: Rule = {
  id: "GSK-FIREBASE-001",
  title: "Firebase security rules allow unconditional access",
  severity: "HIGH",
  description: "A Firestore, Storage or Realtime Database rule grants read or write access with `if true` (or `true`), so any client can read or modify that data.",
  action: "Replace the unconditional rule with one that checks `request.auth` and scopes access to the user's own documents.",
  appliesTo: (file) => file.fileClass === "rules",
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    const isRtdb = file.path.toLowerCase().endsWith("database.rules.json");
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      if (line.length > 5000) continue;
      if (isRtdb) {
        RTDB_OPEN.lastIndex = 0;
        const m = RTDB_OPEN.exec(line);
        if (m) {
          matches.push({ line: i + 1, snippet: sanitize(line.trim(), 160), message: `Realtime Database grants unconditional ${m[1] ?? "access"}.`, details: { operation: m[1] ?? null } });
        }
        continue;
      }
      FIRESTORE_ALLOW.lastIndex = 0;
      for (const m of line.matchAll(FIRESTORE_ALLOW)) {
        const ops = (m[1] ?? "").replace(/\s+/g, "");
        const writes = /write|create|update|delete/.test(ops);
        matches.push({
          line: i + 1,
          snippet: sanitize(line.trim(), 160),
          message: `Rule allows "${ops}" unconditionally.`,
          severity: writes ? "HIGH" : "MODERATE",
          details: { operations: ops, write: writes },
        });
      }
    }
    return matches;
  },
};

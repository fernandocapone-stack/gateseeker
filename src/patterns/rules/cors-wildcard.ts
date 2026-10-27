import { sanitize } from "../../report/text.js";
import type { Rule, RuleMatch } from "../types.js";

/**
 * GSK-CORS-001: a wildcard CORS origin on server or config code. MODERATE on
 * its own; HIGH when the same file also enables credentials, which lets any
 * site drive authenticated requests.
 */

const HEADER_WILDCARD = /Access-Control-Allow-Origin["']?\s*(?:[:,]|=>)\s*(?:value\s*:\s*)?["']\*["']/i;
const HEADER_KEY_ONLY = /["']Access-Control-Allow-Origin["']/i;
const VALUE_WILDCARD = /\bvalue\s*:\s*["']\*["']/i;
const CORS_CALL_WILDCARD = /\bcors\(\s*\{[^}]*\borigin\s*:\s*["']\*["']/i;
const CORS_CALL_DEFAULT = /\bcors\(\s*\)/;
const CREDENTIALS = /(Access-Control-Allow-Credentials["']?\s*(?:[:,]|=>)\s*(?:value\s*:\s*)?["']?true|credentials\s*:\s*true)/i;

const APPLICABLE = new Set(["server", "config", "other"]);

export const corsWildcardRule: Rule = {
  id: "GSK-CORS-001",
  title: "CORS allows any origin",
  severity: "MODERATE",
  description: "A response header or CORS middleware sets Access-Control-Allow-Origin to *, or uses the default cors() which does the same.",
  action: "Restrict the origin to the exact domains that need access. Never combine a wildcard or reflected origin with credentials.",
  appliesTo: (file) => APPLICABLE.has(file.fileClass) && /\.(ts|tsx|js|jsx|mjs|cjs|json|toml)$/i.test(file.path),
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    const withCredentials = CREDENTIALS.test(file.content);
    const severity = withCredentials ? "HIGH" : undefined;
    const suffix = withCredentials ? " The same file also enables credentials." : "";
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      if (line.length > 5000) continue;
      const next = file.lines[i + 1] ?? "";
      let message: string | null = null;
      if (HEADER_WILDCARD.test(line)) message = "Access-Control-Allow-Origin is set to *.";
      else if (HEADER_KEY_ONLY.test(line) && VALUE_WILDCARD.test(next) && !HEADER_KEY_ONLY.test(next)) message = "Access-Control-Allow-Origin is set to * (value on the next line).";
      else if (CORS_CALL_WILDCARD.test(line)) message = "cors() is configured with origin: *.";
      else if (CORS_CALL_DEFAULT.test(line) && !/^\s*(import|const|let|var)\b/.test(line)) message = "cors() without options allows any origin.";
      if (message === null) continue;
      matches.push({
        line: i + 1,
        snippet: sanitize(line.trim(), 160),
        message: message + suffix,
        ...(severity ? { severity } : {}),
        details: { withCredentials },
      });
    }
    return matches;
  },
};

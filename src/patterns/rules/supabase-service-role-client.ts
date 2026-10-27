import { sanitize } from "../../report/text.js";
import type { Rule, RuleMatch } from "../types.js";

/**
 * GSK-SUPABASE-002: client-side code references the Supabase service_role key,
 * which bypasses Row Level Security entirely. Anything that reaches the browser
 * bundle hands that power to every visitor.
 */

const SERVICE_ROLE_REF = /\b(?:process\.env|import\.meta\.env|Deno\.env\.get\(|env)\.?\(?["']?([A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*)\b/g;
const BARE_NAME = /\b([A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*)\b/g;

export const supabaseServiceRoleClientRule: Rule = {
  id: "GSK-SUPABASE-002",
  title: "Supabase service_role key referenced in client code",
  severity: "CRITICAL",
  description: "A file that ships to the browser references an environment variable named like the Supabase service_role key. That key bypasses every Row Level Security policy.",
  action: "Use only the anon key in client code. Move any operation that needs service_role to a server route or edge function, and rotate the service_role key.",
  appliesTo: (file) => file.fileClass === "client",
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      if (line.length > 5000) continue;
      SERVICE_ROLE_REF.lastIndex = 0;
      BARE_NAME.lastIndex = 0;
      const hit = SERVICE_ROLE_REF.exec(line) ?? BARE_NAME.exec(line);
      if (!hit || seen.has(i)) continue;
      seen.add(i);
      matches.push({
        line: i + 1,
        snippet: sanitize(line.trim(), 160),
        message: `Client file references "${hit[1] ?? "SERVICE_ROLE"}".`,
        details: { variable: hit[1] ?? null },
      });
    }
    return matches;
  },
};

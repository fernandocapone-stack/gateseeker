import { sanitize } from "../../report/text.js";
import type { Rule, RuleMatch } from "../types.js";

/**
 * GSK-BUILD-001: next.config disables type or lint errors during build. Common
 * in generated projects; informative, because it hides the checks that would
 * catch many of the other problems.
 */

const PATTERNS: { re: RegExp; what: string }[] = [
  { re: /\bignoreBuildErrors\s*:\s*true\b/, what: "TypeScript errors are ignored during build (typescript.ignoreBuildErrors)." },
  { re: /\bignoreDuringBuilds\s*:\s*true\b/, what: "ESLint errors are ignored during build (eslint.ignoreDuringBuilds)." },
];

export const nextIgnoreBuildErrorsRule: Rule = {
  id: "GSK-BUILD-001",
  title: "Build ignores type or lint errors",
  severity: "LOW",
  description: "next.config sets typescript.ignoreBuildErrors or eslint.ignoreDuringBuilds to true.",
  action: "Remove the flag and fix the reported errors; they often include unsafe types around authentication and data access.",
  appliesTo: (file) => /^next\.config\.(js|mjs|cjs|ts)$/.test(file.path),
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      for (const p of PATTERNS) {
        if (p.re.test(line)) matches.push({ line: i + 1, snippet: sanitize(line.trim(), 160), message: p.what });
      }
    }
    return matches;
  },
};

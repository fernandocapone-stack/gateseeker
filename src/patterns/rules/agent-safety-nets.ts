import { sanitize } from "../../report/text.js";
import type { Rule, RuleMatch } from "../types.js";
import { NEGATED } from "./agent-common.js";

/**
 * GSK-AGENT-005: a committed instruction or script skips the repository's
 * safety nets: `git commit --no-verify` / `-n` (pre-commit hooks), or
 * `HUSKY=0` / `HUSKY_SKIP_HOOKS=1`. Agents follow such instructions on every
 * commit, so one line in CLAUDE.md or a hook disables secret scanning, lint
 * and tests that the team relies on.
 *
 * Files: agent configuration and instructions, package.json scripts, and CI
 * workflows. A line that forbids the practice ("never use --no-verify") is
 * not a finding.
 */

const PATTERNS: { re: RegExp; what: string }[] = [
  { re: /--no-verify\b/, what: "skips git hooks with --no-verify" },
  { re: /\bgit\s+commit\b[^\n]{0,200}\s-n\b/, what: "skips git hooks with git commit -n" },
  { re: /\bHUSKY=0\b|\bHUSKY_SKIP_HOOKS=(?:1|true)\b/, what: "turns Husky hooks off" },
];

function applies(path: string, fileClass: string): boolean {
  const lower = path.toLowerCase();
  return fileClass === "agent" || lower === "package.json" || /^\.github\/workflows\/[^/]+\.ya?ml$/.test(lower) || lower.startsWith(".husky/");
}

export const agentSafetyNetsRule: Rule = {
  id: "GSK-AGENT-005",
  title: "Instruction or script skips the repository's git hooks",
  severity: "MODERATE",
  description: "An agent instruction, a package.json script or a CI workflow commits with --no-verify, git commit -n or HUSKY=0, which skips the pre-commit checks the project set up.",
  action: "Remove the bypass. If a hook is too slow or flaky, fix or narrow the hook instead of skipping it.",
  appliesTo: (file) => applies(file.path, file.fileClass),
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    file.lines.forEach((text, i) => {
      if (text.length > 5000) return;
      for (const p of PATTERNS) {
        const m = p.re.exec(text);
        if (!m) continue;
        if (NEGATED.test(text.slice(0, m.index))) break; // "never use --no-verify"
        matches.push({ line: i + 1, snippet: sanitize(text.trim(), 160), message: `This line ${p.what}.`, details: { bypass: p.what } });
        break;
      }
    });
    return matches;
  },
};

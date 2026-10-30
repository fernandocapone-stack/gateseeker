import { sanitize } from "../../report/text.js";
import type { Rule, RuleMatch } from "../types.js";
import { isRecord, lineOf, parseJson, stringsIn } from "./agent-common.js";

/**
 * GSK-AGENT-002: an agent hook downloads code and runs it.
 *
 * Hooks run automatically on the developer's machine while the agent works
 * (before a tool call, after an edit, on session start). A hook that pipes a
 * download into a shell, or installs whatever version of a package is newest
 * right now, runs code the repository does not pin or review.
 *
 * Looked at: the strings under `hooks` in agent JSON settings, and every line
 * of scripts kept in agent directories (for example `.claude/hooks/*.sh`).
 * The patterns are bounded so a long line cannot cause backtracking.
 */

const PATTERNS: { re: RegExp; what: string }[] = [
  { re: /\b(?:curl|wget)\b[^|\n]{0,300}\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/, what: "pipes a download into a shell" },
  { re: /\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/, what: "runs a downloaded script through process substitution" },
  { re: /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|\n]{0,300}\|\s*(?:iex|Invoke-Expression)\b/i, what: "pipes a download into PowerShell" },
  { re: /\b(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)\s+(?:(?:-y|--yes)\s+)?[\w@./-]{1,214}@latest\b/, what: "runs whatever version of a package is newest at the moment" },
  { re: /\b(?:npx|bunx)\s+(?:-y|--yes)\s+[\w@./-]{1,214}(?:\s|$)/, what: "installs and runs a package without asking or pinning a version" },
];

const SCRIPT = /\.(sh|bash|zsh|ps1|cmd|bat|mjs|cjs|js|ts|py)$/i;

function firstHit(text: string): string | null {
  if (text.length > 5000) return null;
  for (const p of PATTERNS) if (p.re.test(text)) return p.what;
  return null;
}

export const agentRemoteHookRule: Rule = {
  id: "GSK-AGENT-002",
  title: "AI agent hook downloads and runs remote code",
  severity: "HIGH",
  description: "A hook that the agent runs automatically pipes a download into a shell or runs an unpinned package version, so code nobody reviewed runs on every developer's machine.",
  action: "Vendor the script into the repository, or pin the exact package version (with an integrity check when possible), and review it like any other code.",
  appliesTo: (file) => file.fileClass === "agent" && (file.path.toLowerCase().endsWith(".json") || SCRIPT.test(file.path)),
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    if (file.path.toLowerCase().endsWith(".json")) {
      const json = parseJson(file);
      if (!isRecord(json)) return matches;
      // Cursor runs install/start/terminals of .cursor/environment.json on its own when it sets up a background agent.
      const cursorEnv = file.path.toLowerCase() === ".cursor/environment.json";
      const commands = cursorEnv ? stringsIn([json.install, json.start, json.terminals]) : json.hooks === undefined ? [] : stringsIn(json.hooks);
      const seen = new Set<string>();
      for (const command of commands) {
        const what = firstHit(command);
        if (what === null || seen.has(command)) continue;
        seen.add(command);
        // The file holds the JSON-escaped text: look the line up by the command's start, before any quote, backslash or newline.
        const line = lineOf(file, command.split(/["\\\n]/)[0]?.slice(0, 50) ?? command);
        matches.push({ line, snippet: sanitize((file.lines[line - 1] ?? "").trim(), 160), message: cursorEnv ? `The Cursor background-agent setup ${what}.` : `An agent hook ${what}.`, details: { where: cursorEnv ? "cursor-environment" : "settings", pattern: what } });
      }
      return matches;
    }
    file.lines.forEach((text, i) => {
      if (/^\s*(#|\/\/|REM\b)/i.test(text)) return; // commented out
      const what = firstHit(text);
      if (what !== null) matches.push({ line: i + 1, snippet: sanitize(text.trim(), 160), message: `A script in an agent directory ${what}.`, details: { where: "script", pattern: what } });
    });
    return matches;
  },
};

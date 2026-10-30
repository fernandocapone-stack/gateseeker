import { sanitize } from "../../report/text.js";
import type { Rule, RuleMatch } from "../types.js";
import { isClaudeSettings, isRecord, lineOf, parseJson } from "./agent-common.js";

/**
 * GSK-AGENT-001: an AI coding agent may run any command without asking.
 *
 * Claude Code (`.claude/settings.json`): `permissions.allow` containing
 * `Bash`, `Bash(*)` or `*`, or `permissions.defaultMode: "bypassPermissions"`.
 * Codex (`.codex/config.toml`): `approval_policy = "never"` together with
 * `sandbox_mode = "danger-full-access"`. A committed setting applies to
 * everyone who opens the repository with that agent, which is why it is a
 * finding even though each developer can choose the same thing locally.
 */

const UNRESTRICTED = new Set(["bash", "bash(*)", "bash(:*)", "*", "shell(*)"]);
const CODEX_NEVER = /^\s*approval_policy\s*=\s*["']never["']/m;
const CODEX_FULL = /^\s*sandbox_mode\s*=\s*["']danger-full-access["']/m;

export const agentPermissionsRule: Rule = {
  id: "GSK-AGENT-001",
  title: "AI agent may run any command without asking",
  severity: "MODERATE",
  description: "A committed agent configuration allows every shell command, or turns off the approval prompt, for everyone who opens the repository with that agent.",
  action: "Remove the blanket permission and allow only the specific commands the project needs (for example the test and lint scripts).",
  appliesTo: (file) => file.fileClass === "agent" && (isClaudeSettings(file.path) || /^\.codex\/config\.toml$/i.test(file.path)),
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    if (file.path.toLowerCase().endsWith(".toml")) {
      if (CODEX_NEVER.test(file.content) && CODEX_FULL.test(file.content)) {
        const line = lineOf(file, "approval_policy");
        matches.push({ line, snippet: sanitize((file.lines[line - 1] ?? "").trim(), 160), message: "Codex is configured to never ask for approval with full access to the machine.", details: { agent: "codex", setting: "approval_policy=never+danger-full-access" } });
      }
      return matches;
    }
    const json = parseJson(file);
    const permissions = isRecord(json) && isRecord(json.permissions) ? json.permissions : null;
    if (!permissions) return matches;
    if (permissions.defaultMode === "bypassPermissions") {
      const line = lineOf(file, "bypassPermissions");
      matches.push({ line, snippet: sanitize((file.lines[line - 1] ?? "").trim(), 160), message: "Claude Code is set to bypass every permission prompt.", details: { agent: "claude-code", setting: "defaultMode=bypassPermissions" } });
    }
    const allow = Array.isArray(permissions.allow) ? permissions.allow : [];
    for (const entry of allow) {
      if (typeof entry !== "string" || !UNRESTRICTED.has(entry.replace(/\s+/g, "").toLowerCase())) continue;
      const line = lineOf(file, `"${entry}"`);
      matches.push({ line, snippet: sanitize((file.lines[line - 1] ?? "").trim(), 160), message: `Claude Code allows "${sanitize(entry, 20)}": any shell command runs without asking.`, details: { agent: "claude-code", setting: `allow:${sanitize(entry, 20)}` } });
    }
    return matches;
  },
};

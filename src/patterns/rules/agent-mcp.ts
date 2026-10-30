import { sanitize } from "../../report/text.js";
import { looksLikePlaceholder, redactInLine } from "../redact.js";
import type { SeverityTier } from "../../types.js";
import type { Rule, RuleMatch } from "../types.js";
import { isRecord, lineOf, parseJson } from "./agent-common.js";

/**
 * GSK-AGENT-003: an MCP server in a committed agent configuration is risky
 * to start.
 *
 *   - unpinned: launched with npx, bunx, uvx or a dlx runner without an exact
 *     version (or with @latest), so whatever is published next runs with the
 *     agent's access (MODERATE);
 *   - plaintext: a remote server reached over http:// (MODERATE);
 *   - inline secret: a literal value in `env` or `headers` instead of a
 *     reference such as ${VAR} (HIGH). The value is never reported; the
 *     snippet goes through redactInLine like every other secret.
 *
 * Files: `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` (key `servers`)
 * and any agent JSON with an `mcpServers` object.
 */

const RUNNERS = new Set(["npx", "bunx", "uvx", "pnpx"]);
const DLX = new Set(["pnpm", "yarn"]);
const PINNED = /(?:@|==)\d[\w.+-]*$/;
const REFERENCE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$|^\$\{(?:env|input):[^}]+\}$/;

function packageArg(command: string, args: string[]): string | null {
  const base = command.replace(/\\/g, "/").split("/").pop()?.replace(/\.(cmd|exe)$/i, "").toLowerCase() ?? "";
  let rest = args;
  if (DLX.has(base)) {
    if (rest[0] !== "dlx") return null;
    rest = rest.slice(1);
  } else if (!RUNNERS.has(base)) {
    return null;
  }
  // uvx --from pkg==1.2 tool: the --from value is the package.
  const from = rest.indexOf("--from");
  if (from >= 0 && typeof rest[from + 1] === "string") return rest[from + 1] ?? null;
  return rest.find((a) => !a.startsWith("-")) ?? null;
}

function looksSecret(value: string): boolean {
  if (value.length < 12 || REFERENCE.test(value.trim())) return false;
  // "Bearer ${TOKEN}": a reference with a prefix is still a reference.
  if (/\$\{[^}]{1,100}\}/.test(value)) return false;
  if (/^https?:\/\//i.test(value) || /^(true|false|\d+)$/i.test(value)) return false;
  return !looksLikePlaceholder(value) && !/your|example|changeme|placeholder|<|xxx/i.test(value);
}

export const agentMcpRule: Rule = {
  id: "GSK-AGENT-003",
  title: "MCP server configured with an unpinned package, plain HTTP or an inline secret",
  severity: "MODERATE",
  description: "An MCP server in a committed agent configuration runs an unpinned package, talks to a remote server over plain HTTP, or carries a secret written in the file.",
  action: "Pin the server package to an exact version, use https for remote servers, and reference secrets from environment variables (${VAR}) instead of writing them in the file.",
  appliesTo: (file) => file.fileClass === "agent" && file.path.toLowerCase().endsWith(".json"),
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    const json = parseJson(file);
    if (!isRecord(json)) return matches;
    const servers = isRecord(json.mcpServers) ? json.mcpServers : file.path.toLowerCase() === ".vscode/mcp.json" && isRecord(json.servers) ? json.servers : null;
    if (!servers) return matches;
    for (const [name, raw] of Object.entries(servers)) {
      if (!isRecord(raw)) continue;
      const server = sanitize(name, 60);
      const push = (line: number, message: string, severity: SeverityTier, issue: string, secrets: string[] = []) => {
        matches.push({ line, snippet: redactInLine((file.lines[line - 1] ?? "").trim(), secrets), message, severity, details: { server, issue } });
      };
      const args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === "string") : [];
      const pkg = typeof raw.command === "string" ? packageArg(raw.command, args) : null;
      if (pkg !== null && (!PINNED.test(pkg) || pkg.endsWith("@latest"))) {
        push(lineOf(file, pkg), `MCP server "${server}" runs ${sanitize(pkg, 80)} without an exact version.`, "MODERATE", "unpinned");
      }
      if (typeof raw.url === "string" && /^http:\/\//i.test(raw.url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(raw.url)) {
        push(lineOf(file, raw.url), `MCP server "${server}" is reached over plain HTTP.`, "MODERATE", "plaintext");
      }
      for (const key of ["env", "headers"] as const) {
        const bag = raw[key];
        if (!isRecord(bag)) continue;
        for (const [k, v] of Object.entries(bag)) {
          if (typeof v !== "string" || !looksSecret(v)) continue;
          push(lineOf(file, `"${k}"`), `MCP server "${server}" has a literal value in ${key}.${sanitize(k, 40)} (${String(v.length)} characters) instead of a reference to an environment variable.`, "HIGH", "inline-secret", [v]);
        }
      }
    }
    return matches;
  },
};

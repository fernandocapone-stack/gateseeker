import { sanitize } from "../report/text.js";

/**
 * The inline suppression comment, shared by the engine (which reads it) and
 * the web report's "Accept the risk" helper (which writes it). A suppression
 * covers its own line and the next one, so the helper's comment goes on the
 * line above the finding. Browser-safe: no Node imports.
 */

export const SUPPRESS_RE = /gateseeker-ignore\s+(GSK-[A-Z]+-\d{3})(?:\s+(.*))?$/;
export const MAX_SUPPRESSION_REASON = 200;

interface Style {
  open: string;
  close: string;
}

const LINE_SLASH: Style = { open: "// ", close: "" };
const LINE_HASH: Style = { open: "# ", close: "" };
const LINE_DASH: Style = { open: "-- ", close: "" };
const BLOCK_C: Style = { open: "/* ", close: " */" };
const BLOCK_HTML: Style = { open: "<!-- ", close: " -->" };

/* By file name or extension; JSON has no comments, so it gets none. */
function styleFor(path: string): Style | null {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === ".env" || name.startsWith(".env.") || name === ".gitignore" || name === "dockerfile") return LINE_HASH;
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "rules", "java", "kt", "go", "rs", "swift", "dart", "php"].includes(ext)) return LINE_SLASH;
  if (["yml", "yaml", "toml", "sh", "bash", "py", "rb", "ini", "conf", "properties"].includes(ext)) return LINE_HASH;
  if (ext === "sql") return LINE_DASH;
  if (["css", "scss", "less"].includes(ext)) return BLOCK_C;
  if (["html", "htm", "vue", "svelte", "md", "mdx", "xml", "svg"].includes(ext)) return BLOCK_HTML;
  return null;
}

/** The reason as it will be written: one line, no comment terminators, capped. */
export function cleanReason(reason: string): string {
  return sanitize(reason, MAX_SUPPRESSION_REASON).replace(/\*\/|-->/g, "").trim();
}

/**
 * The comment to paste on the line above a finding, or null when the reason
 * is empty, the rule id is malformed or the file type has no comment syntax
 * (JSON).
 */
export function suppressionComment(path: string, ruleId: string, reason: string): string | null {
  if (!/^GSK-[A-Z]+-\d{3}$/.test(ruleId)) return null;
  const why = cleanReason(reason);
  if (why === "") return null;
  const style = styleFor(path);
  if (!style) return null;
  return `${style.open}gateseeker-ignore ${ruleId} ${why}${style.close}`;
}

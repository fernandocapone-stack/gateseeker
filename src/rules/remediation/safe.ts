import { sanitize } from "../../report/text.js";

/**
 * Values that enter a fix prompt come from the analyzed project (paths,
 * variable and table names) or from a registry (package names, versions), so
 * they are untrusted twice over: a crafted value could try to steer the AI
 * tool the user pastes the prompt into. Each kind has a strict allowlist;
 * anything outside it becomes "?", and the result is length-capped. Code
 * snippets never enter a prompt at all.
 */

function allow(raw: unknown, pattern: RegExp, max: number, fallback: string): string {
  if (typeof raw !== "string" && typeof raw !== "number") return fallback;
  const clean = sanitize(String(raw), max).replace(pattern, "?");
  return clean === "" ? fallback : clean;
}

/** A project-relative path: letters, digits and . _ - / @ + only. */
export function safePath(raw: unknown): string {
  return allow(raw, /[^A-Za-z0-9._\-/@+]/g, 160, "the file");
}

/** An identifier such as an environment variable or a column: letters, digits, underscore. */
export function safeIdent(raw: unknown, fallback = "the variable"): string {
  return allow(raw, /[^A-Za-z0-9_]/g, 80, fallback);
}

/** A table name, optionally schema-qualified. */
export function safeTable(raw: unknown): string {
  return allow(raw, /[^A-Za-z0-9_.]/g, 120, "the table");
}

/** An npm or Composer package name. */
export function safePackage(raw: unknown): string {
  return allow(raw, /[^A-Za-z0-9@._\-/]/g, 214, "the package");
}

/** A version string. */
export function safeVersion(raw: unknown): string {
  return allow(raw, /[^A-Za-z0-9.+-]/g, 64, "?");
}

/** A short label such as a credential type or advisory id. */
export function safeLabel(raw: unknown, fallback: string): string {
  return allow(raw, /[^A-Za-z0-9 ._\-/()]/g, 60, fallback);
}

/** The closing paragraph of every fix prompt. */
export const PROMPT_FOOTER =
  "Do not weaken or turn off any check, test, linter or security rule to make this go away, and do not print or log secret values. When you are done, summarize what you changed and anything I still need to do by hand.";

import type { ProjectFile } from "../types.js";

/**
 * Helpers shared by the GSK-AGENT-* rules (Track A1). Agent configuration is
 * mostly JSON; it is parsed, never evaluated, and a file that does not parse
 * simply yields nothing for the JSON-based checks.
 */

export function parseJson(file: ProjectFile): unknown {
  try {
    return JSON.parse(file.content) as unknown;
  } catch {
    try {
      // JSON with comments (VS Code's mcp.json, for example); this also lets a gateseeker-ignore comment sit in it.
      return JSON.parse(stripJsonComments(file.content)) as unknown;
    } catch {
      return undefined;
    }
  }
}

/** Removes // and /* *\/ comments outside strings, keeping line breaks so line numbers stay put. Linear. */
export function stripJsonComments(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const c = text[i] ?? "";
    const next = text[i + 1] ?? "";
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i++;
    } else if (c === '"') {
      inString = true;
      out += c;
      i++;
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 1-based line of the first line containing `needle`, or 1. */
export function lineOf(file: ProjectFile, needle: string): number {
  const i = file.lines.findIndex((l) => l.includes(needle));
  return i < 0 ? 1 : i + 1;
}

/** Every string inside a JSON value, with no depth limit beyond the file size the walker allows. */
export function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
  else if (isRecord(v)) for (const x of Object.values(v)) stringsIn(x, out);
  return out;
}

const SETTINGS = /^\.claude\/settings(\.local)?\.json$/i;

/** Claude Code settings files, the most common agent configuration in repositories. */
export function isClaudeSettings(path: string): boolean {
  return SETTINGS.test(path);
}

/** Text that negates the instruction on the same line ("never use --no-verify"). */
export const NEGATED = /\b(no|not|never|don't|do not|avoid|without|forbid(?:den)?|disallow(?:ed)?|must not)\b/i;

import { sanitize } from "../../report/text.js";
import type { Rule, RuleMatch } from "../types.js";

/**
 * GSK-AGENT-004: an instruction file that AI agents read carries text a
 * person reviewing it would not see or would not read as an instruction.
 *
 *   - invisible characters: zero-width, bidirectional controls and Unicode
 *     "tag" characters, which models read but editors and diffs hide (HIGH);
 *   - an HTML comment (hidden when the Markdown is rendered) that tells the
 *     agent to ignore earlier instructions, keep something from the user, or
 *     download, encode or send data (MODERATE);
 *   - a long base64-looking run, which can hide an instruction (MODERATE).
 *
 * Files: CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules and the like, and the
 * Markdown/text files in agent directories (commands, sub-agents, rules).
 * Nothing here is executed or followed; the files are read as text.
 */

// Zero-width and joiners, bidi embeddings/overrides/isolates, word joiner and invisible operators, BOM (except at offset 0), tag characters.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u;
const INVISIBLE_G = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;
const MANIPULATION =
  /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|above|prior|earlier|all|system)\b[^.\n]{0,20}\b(?:instructions?|rules|prompts?)\b|\bdo not (?:tell|mention|reveal|show|inform)\b|\bwithout (?:telling|asking|informing)\b|\b(?:curl|wget|exfiltrat\w*)\b|\bbase64\b|\bsend\b[^.\n]{0,60}\b(?:to https?:|to the url|webhook)\b/i;
const BASE64_RUN = /[A-Za-z0-9+/]{160,}={0,2}/;

const INSTRUCTION_FILES = new Set(["claude.md", "agents.md", "gemini.md", ".cursorrules", ".windsurfrules", ".clinerules", "copilot-instructions.md"]);

function isInstructionFile(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  return INSTRUCTION_FILES.has(base) || /\.(md|mdc|txt)$/.test(base);
}

/** HTML comments found with indexOf (linear; no regex backtracking on unclosed comments); bodies capped at 4000 characters. */
function htmlComments(content: string): { start: number; body: string }[] {
  const out: { start: number; body: string }[] = [];
  let from = 0;
  for (;;) {
    const start = content.indexOf("<!--", from);
    if (start < 0) break;
    const end = content.indexOf("-->", start + 4);
    if (end < 0) break;
    out.push({ start, body: content.slice(start + 4, Math.min(end, start + 4 + 4000)) });
    from = end + 3;
  }
  return out;
}

/** Shows invisible characters as [U+XXXX] so the snippet is readable and harmless. */
function reveal(line: string): string {
  return line.replace(INVISIBLE_G, (c) => `[U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}]`);
}

export const agentHiddenInstructionsRule: Rule = {
  id: "GSK-AGENT-004",
  title: "Hidden text in a file that AI agents follow",
  severity: "MODERATE",
  description: "An agent instruction file contains invisible Unicode characters, an HTML comment with instructions a reader would not see, or a long encoded run that can hide an instruction.",
  action: "Open the file in an editor that shows invisible characters, remove anything you did not write on purpose, and review where it came from (a pull request, a template, a dependency).",
  appliesTo: (file) => file.fileClass === "agent" && isInstructionFile(file.path),
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    file.lines.forEach((raw, i) => {
      const text = i === 0 ? raw.replace(/^\uFEFF/, "") : raw;
      if (text.length > 20_000) return;
      if (INVISIBLE.test(text)) {
        const count = [...text.matchAll(INVISIBLE_G)].length;
        matches.push({ line: i + 1, snippet: sanitize(reveal(text.trim()), 160), message: `${String(count)} invisible character(s) that editors and diffs do not show.`, severity: "HIGH", details: { kind: "invisible", count } });
      } else if (BASE64_RUN.test(text)) {
        matches.push({ line: i + 1, snippet: sanitize(text.trim(), 80), message: "A long encoded run that a reviewer cannot read.", severity: "MODERATE", details: { kind: "encoded" } });
      }
    });
    for (const c of htmlComments(file.content)) {
      // Line breaks inside the comment must not split the phrase the pattern looks for.
      if (!MANIPULATION.test(c.body.replace(/\s+/g, " "))) continue;
      const line = file.content.slice(0, c.start).split("\n").length;
      matches.push({ line, snippet: sanitize(`<!--${c.body}-->`.trim(), 160), message: "An HTML comment, hidden when the Markdown is rendered, gives the agent instructions.", severity: "MODERATE", details: { kind: "comment" } });
    }
    return matches.sort((a, b) => a.line - b.line);
  },
};

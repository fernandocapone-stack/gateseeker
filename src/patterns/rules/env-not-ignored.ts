import { redactEnvLine } from "../redact.js";
import { PUBLIC_PREFIXES } from "./secret-public-env.js";
import type { Rule, RuleMatch } from "../types.js";

/**
 * GSK-ENV-001: a dotenv file at the project root holds at least one non-public
 * variable with a value, and the root .gitignore does not cover it. Gateseeker
 * cannot know whether git tracks the file (it never runs git), so the message
 * says what to verify.
 */

const EXAMPLE = /^\.env\.(example|sample|template|dist)$/i;

function isRootEnvFile(path: string): boolean {
  return !path.includes("/") && (path === ".env" || path.startsWith(".env.")) && !EXAMPLE.test(path);
}

export const envNotIgnoredRule: Rule = {
  id: "GSK-ENV-001",
  title: "dotenv file with secrets is not covered by .gitignore",
  severity: "MODERATE",
  description: "A .env file at the project root contains non-public variables with values and no .gitignore pattern excludes it, so it is likely committed.",
  action: "Add the file to .gitignore, remove it from the repository history if it was committed, and rotate every value it contains.",
  appliesTo: (file) => file.fileClass === "env" && isRootEnvFile(file.path),
  check: ({ file, project }) => {
    if (project.isGitignored(file.path)) return [];
    let firstSecretLine = -1;
    let count = 0;
    for (let i = 0; i < file.lines.length; i++) {
      const line = (file.lines[i] ?? "").trim();
      if (line === "" || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const name = line.slice(0, eq).replace(/^export\s+/, "").trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (value === "") continue;
      if (PUBLIC_PREFIXES.some((p) => name.startsWith(p))) continue;
      count++;
      if (firstSecretLine === -1) firstSecretLine = i + 1;
    }
    if (count === 0) return [];
    const matches: RuleMatch[] = [
      {
        line: firstSecretLine,
        snippet: redactEnvLine(file.lines[firstSecretLine - 1] ?? ""),
        message: `${file.path} holds ${count} non-public variable(s) with values and is not matched by .gitignore${project.byPath.has(".gitignore") ? "" : " (no .gitignore found)"}. Verify with \`git ls-files ${file.path}\`.`,
        details: { nonPublicVariables: count, gitignorePresent: project.byPath.has(".gitignore") },
      },
    ];
    return matches;
  },
};

import { execFile } from "node:child_process";

/**
 * Narrow git runner for the triage server. Only read-only and additive
 * operations are allowed; anything else is refused before reaching git.
 */

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[]) => Promise<GitResult>;

const ALLOWED = new Set(["add", "commit", "push", "fetch", "merge", "rev-parse", "config", "status", "branch", "log", "rev-list"]);
const FORBIDDEN_FLAGS = /^(--force|-f|--hard|--delete|-D|-d|--amend|--no-verify|--exec|-c)$/;

export function assertAllowed(args: string[]): void {
  const sub = args[0];
  if (sub === undefined || !ALLOWED.has(sub)) throw new Error(`git ${sub ?? ""} is not allowed by the triage server`);
  for (const a of args.slice(1)) {
    if (FORBIDDEN_FLAGS.test(a)) throw new Error(`git flag ${a} is not allowed by the triage server`);
  }
  if (sub === "merge" && !args.includes("--no-edit")) throw new Error("git merge must be non-interactive");
  if (sub === "config" && !(args[1] === "--get" || args[1] === "user.name")) throw new Error("git config is read-only here");
}

export function makeGitRunner(cwd: string): GitRunner {
  return (args) =>
    new Promise((resolve) => {
      try {
        assertAllowed(args);
      } catch (err) {
        resolve({ code: 126, stdout: "", stderr: err instanceof Error ? err.message : String(err) });
        return;
      }
      execFile("git", args, { cwd, timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : error ? 1 : 0;
        resolve({ code, stdout, stderr });
      });
    });
}

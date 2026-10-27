import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { renderSarif } from "../report/sarif.js";
import { renderSummary } from "../report/summary.js";
import { lockfileKind, scanDirectory } from "../scan.js";
import type { Report } from "../types.js";
import { upsertStickyComment } from "./github.js";

/**
 * The Action runner. Reads the Action's inputs from INPUT_* environment
 * variables (as the composite action passes them), runs the scan, writes the
 * JSON report, the SARIF file, the job summary and the step outputs, posts
 * the sticky PR comment when possible, and returns the exit code.
 *
 * This is the only place in Gateseeker that runs git: it lives inside the
 * user's workflow, after their own checkout, to fetch the baseline lockfile
 * from the base branch. The scanner itself still never runs git.
 */

const execFileAsync = promisify(execFile);

export interface ActionIo {
  env: Record<string, string | undefined>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  fetch?: typeof fetch;
  /** Injected for tests; defaults to `git` in the workspace. */
  gitShow?: (ref: string, path: string, cwd: string) => Promise<string | null>;
}

function input(env: ActionIo["env"], name: string): string | undefined {
  const v = env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`];
  return v === undefined || v === "" ? undefined : v;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return /^(true|1|yes)$/i.test(v);
}

function oneOf<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T {
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

async function defaultGitShow(ref: string, path: string, cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${ref}:${path}`], { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    return stdout;
  } catch {
    return null;
  }
}

async function prNumberFromEvent(env: ActionIo["env"]): Promise<number | null> {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return null;
  try {
    const ev = JSON.parse(await readFile(path, "utf8")) as { pull_request?: { number?: number }; number?: number };
    const n = ev.pull_request?.number ?? ev.number;
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
}

export async function runAction(io: ActionIo): Promise<number> {
  const env = io.env;
  const workspace = env.GITHUB_WORKSPACE ?? process.cwd();
  const root = resolve(workspace, input(env, "path") ?? ".");
  const failOn = oneOf(input(env, "fail-on")?.toUpperCase(), ["P1", "P2", "P3", "P4"] as const, "P2");
  const patternsMode = oneOf(input(env, "patterns"), ["warn", "gate"] as const, "warn");
  const supplyChainMode = oneOf(input(env, "supply-chain"), ["warn", "gate"] as const, "warn");
  const only = input(env, "only") !== undefined ? oneOf(input(env, "only"), ["deps", "patterns"] as const, "deps") : undefined;
  const allowIncomplete = bool(input(env, "allow-incomplete"), false);
  const wantComment = bool(input(env, "comment"), true);
  const wantSarif = bool(input(env, "sarif"), true);
  const baselineRef = input(env, "baseline-ref") ?? (env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : undefined);
  const outDir = resolve(workspace, input(env, "output-dir") ?? ".gateseeker");
  const num = (name: string): number | undefined => {
    const v = input(env, name);
    return v === undefined ? undefined : Number(v);
  };

  await mkdir(outDir, { recursive: true });

  // Baseline from the base branch, when a lockfile exists there.
  let baseline: { path: string; content: string } | undefined;
  let baselineNote = "no baseline (not a pull request, or baseline-ref empty)";
  if (baselineRef) {
    const gitShow = io.gitShow ?? defaultGitShow;
    for (const kind of ["package-lock.json", "composer.lock"]) {
      const relPath = join(input(env, "path") ?? ".", kind).split("\\").join("/").replace(/^\.\//, "");
      const content = await gitShow(baselineRef, relPath, workspace);
      if (content !== null && lockfileKind(kind, content) !== null) {
        const baselinePath = join(outDir, `baseline.${kind}`);
        await writeFile(baselinePath, content, "utf8");
        baseline = { path: baselinePath, content };
        baselineNote = `baseline ${kind} from ${baselineRef}`;
        break;
      }
    }
    if (!baseline) baselineNote = `no lockfile found at ${baselineRef}; comparison rules did not run`;
  }

  const result = await scanDirectory({
    root,
    failOn,
    patternsMode,
    supplyChainMode,
    ...(only !== undefined ? { only } : {}),
    ...(baseline ? { baseline } : {}),
    ...(input(env, "advisories") !== undefined ? { advisoriesPath: resolve(workspace, input(env, "advisories") ?? "") } : {}),
    limits: { ...(num("max-size") !== undefined ? { maxBytes: num("max-size") ?? 0 } : {}), ...(num("max-deps") !== undefined ? { maxDependencies: num("max-deps") ?? 0 } : {}) },
    walkLimits: { ...(num("max-files") !== undefined ? { maxFiles: num("max-files") ?? 0 } : {}), ...(num("max-file-size") !== undefined ? { maxFileBytes: num("max-file-size") ?? 0 } : {}) },
    osv: { ...(num("timeout") !== undefined ? { timeoutMs: num("timeout") ?? 0 } : {}), ...(num("concurrency") !== undefined ? { concurrency: num("concurrency") ?? 0 } : {}) },
  });

  if (!result.ok) {
    io.stderr(`::error::Gateseeker could not analyze the project (${result.error.code}): ${result.error.message}\n`);
    return 3;
  }
  const report: Report = result.report;

  const reportPath = join(outDir, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  let sarifPath: string | null = null;
  if (wantSarif) {
    sarifPath = join(outDir, "gateseeker.sarif");
    await writeFile(sarifPath, `${JSON.stringify(renderSarif(report), null, 2)}\n`, "utf8");
  }

  const summary = `${renderSummary(report)}\n\n<sub>${baselineNote}</sub>`;
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  if (env.GITHUB_OUTPUT) {
    const out = [
      `verdict=${report.gate.verdict}`,
      `findings=${report.findings.length}`,
      `p1=${report.summary.byPriority.P1}`,
      `p2=${report.summary.byPriority.P2}`,
      `p3=${report.summary.byPriority.P3}`,
      `p4=${report.summary.byPriority.P4}`,
      `report=${reportPath}`,
      `sarif=${sarifPath ?? ""}`,
    ].join("\n");
    await appendFile(env.GITHUB_OUTPUT, `${out}\n`, "utf8");
  }

  const prNumber = await prNumberFromEvent(env);
  if (wantComment && prNumber !== null && env.GITHUB_TOKEN && env.GITHUB_REPOSITORY) {
    const r = await upsertStickyComment({ apiUrl: env.GITHUB_API_URL ?? "https://api.github.com", token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, ...(io.fetch ? { fetch: io.fetch } : {}) }, prNumber, summary);
    if (r.ok) io.stdout(`Pull request comment ${r.action} (#${r.id}).\n`);
    else io.stderr(`::warning::Could not post the pull request comment (needs pull-requests: write): ${r.error}\n`);
  } else if (wantComment && prNumber !== null) {
    io.stderr("::warning::No GITHUB_TOKEN available; skipping the pull request comment.\n");
  }

  io.stdout(`Gateseeker verdict: ${report.gate.verdict} (${report.findings.length} finding(s); P1 ${report.summary.byPriority.P1}, P2 ${report.summary.byPriority.P2}). ${baselineNote}.\n`);
  if (report.gate.verdict === "pass") return 0;
  if (report.gate.verdict === "fail") {
    io.stderr(`::error::Gateseeker gate failed: ${report.gate.reason}\n`);
    return 1;
  }
  if (allowIncomplete) {
    io.stderr(`::warning::Gateseeker analysis is incomplete and allow-incomplete is set: ${report.gate.reason}\n`);
    return 0;
  }
  io.stderr(`::error::Gateseeker analysis is incomplete: ${report.gate.reason} Set allow-incomplete: true to accept this.\n`);
  return 2;
}

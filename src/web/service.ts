import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { scanDirectory, type ScanCommonOptions } from "../scan.js";
import type { Report } from "../types.js";
import { parseGitHubRepoUrl, type GitHubRepoRef } from "./github-url.js";
import { DEFAULT_TAR_LIMITS, extractTarGz, type TarLimits } from "./tar.js";

/**
 * The hosted service's one job: given a public GitHub repository URL,
 * download its archive, extract it under strict limits, run the same
 * `scanDirectory` the CLI runs, and return the report.
 *
 * The service is an ordinary user of the engine: no git, no process spawning,
 * no token in this sprint. `fetch` is injected so tests never reach the
 * network, exactly like the OSV client.
 */

export type ServiceErrorCode =
  | "invalid-url"
  | "not-found"
  | "private"
  | "too-large"
  | "unsupported"
  | "ref-not-found"
  | "download-failed"
  | "archive-rejected"
  | "scan-failed"
  | "timeout"
  | "upstream-error";

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
}

export interface ServiceLimits {
  /** GitHub's reported repository size, in bytes (the API reports kilobytes). */
  maxRepositoryBytes: number;
  /** Compressed archive download. */
  maxDownloadBytes: number;
  /** Whole operation, from first request to report. */
  totalTimeoutMs: number;
  tar: TarLimits;
}

export const DEFAULT_SERVICE_LIMITS: ServiceLimits = {
  // GitHub's reported size is the .git size, a loose proxy; the compressed-archive limit below is the real gate.
  maxRepositoryBytes: 100 * 1024 * 1024,
  maxDownloadBytes: DEFAULT_TAR_LIMITS.maxCompressedBytes,
  totalTimeoutMs: 120_000,
  tar: DEFAULT_TAR_LIMITS,
};

export interface ServiceOptions {
  url: string;
  fetch?: typeof fetch;
  /** Where temporary extraction directories are created (default: os.tmpdir()). */
  workDir?: string;
  limits?: Partial<ServiceLimits>;
  /** Passed through to the engine (OSV/Packagist options, rules, limits, now, runId). */
  scan?: Omit<ScanCommonOptions, "baseline">;
  apiBase?: string; // default https://api.github.com
  archiveBase?: string; // default https://codeload.github.com
  userAgent?: string;
  /** Optional GitHub token (read-only, public repositories) to lift the anonymous API limit; never logged, never in reports. */
  githubToken?: string;
  /** A repository already resolved by `resolveGitHubRepository`; skips the two metadata calls. */
  resolved?: ResolvedRepository;
}

export interface ResolvedRepository extends GitHubRepoRef {
  sha: string;
  defaultBranch: string;
  htmlUrl: string;
}

export type ResolveResult = { ok: true; value: ResolvedRepository } | { ok: false; error: ServiceError };

export interface ServiceSuccess {
  repository: ResolvedRepository;
  archive: { files: number; bytes: number; skippedLarge: number; sha256: string };
  report: Report;
  timings: { downloadMs: number; extractMs: number; scanMs: number; totalMs: number };
}

export type ServiceResult = { ok: true; value: ServiceSuccess } | { ok: false; error: ServiceError };

const repoSchema = z.looseObject({
  full_name: z.string(),
  private: z.boolean(),
  size: z.number().nonnegative(), // kilobytes
  default_branch: z.string().min(1),
  html_url: z.string(),
  archived: z.boolean().optional(),
  fork: z.boolean().optional(),
});

const commitSchema = z.looseObject({ sha: z.string().regex(/^[0-9a-f]{40}$/) });

/** Reads a response body up to `max` bytes; refuses larger ones without buffering them. */
async function readLimited(res: Response, max: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const UA = "gateseeker-web (+https://github.com/gateseeker-dev/gateseeker)";

type ApiAnswer = { kind: "http"; status: number; json: unknown } | { kind: "network"; message: string };

function githubApi(options: Pick<ServiceOptions, "fetch" | "apiBase" | "userAgent" | "githubToken">, signal: AbortSignal): (path: string) => Promise<ApiAnswer> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const apiBase = (options.apiBase ?? "https://api.github.com").replace(/\/$/, "");
  const ua = options.userAgent ?? UA;
  return async (path) => {
    try {
      const res = await fetchFn(`${apiBase}${path}`, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": ua,
          "x-github-api-version": "2022-11-28",
          ...(options.githubToken ? { authorization: `Bearer ${options.githubToken}` } : {}),
        },
        signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        json = null;
      }
      return { kind: "http", status: res.status, json };
    } catch (e) {
      return { kind: "network", message: (e as Error).message };
    }
  };
}

/**
 * Steps 1 and 2 of the service on their own: validate the URL, check the
 * repository exists, is public and within the size limit, and resolve the
 * ref to a commit. Callers with a cache use this first (two cheap API calls,
 * no download) and pass the result back as `resolved` to skip repeating them.
 */
export async function resolveGitHubRepository(options: Omit<ServiceOptions, "resolved">): Promise<ResolveResult> {
  const limits: ServiceLimits = { ...DEFAULT_SERVICE_LIMITS, ...options.limits, tar: { ...DEFAULT_TAR_LIMITS, ...options.limits?.tar } };
  const parsed = parseGitHubRepoUrl(options.url);
  if (!parsed.ok) return { ok: false, error: { code: "invalid-url", message: parsed.reason } };
  const { owner, repo, ref } = parsed.value;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, limits.totalTimeoutMs);
  try {
    return await resolveWith(githubApi(options, controller.signal), controller.signal, owner, repo, ref, limits);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveWith(api: (path: string) => Promise<ApiAnswer>, signal: AbortSignal, owner: string, repo: string, ref: string | null, limits: ServiceLimits): Promise<ResolveResult> {
  // 1. Repository metadata: existence, visibility, size, default branch.
  const meta = await api(`/repos/${owner}/${repo}`);
  if (meta.kind === "network") return { ok: false, error: { code: signal.aborted ? "timeout" : "upstream-error", message: `GitHub could not be reached: ${meta.message}` } };
  if (meta.status === 404) return { ok: false, error: { code: "not-found", message: `${owner}/${repo} was not found on GitHub, or it is private. Only public repositories can be analyzed.` } };
  if (meta.status === 403 || meta.status === 429) return { ok: false, error: { code: "upstream-error", message: "GitHub is rate-limiting this service right now. Try again in a few minutes." } };
  if (meta.status !== 200) return { ok: false, error: { code: "upstream-error", message: `GitHub answered HTTP ${meta.status} for the repository.` } };
  const repoInfo = repoSchema.safeParse(meta.json);
  if (!repoInfo.success) return { ok: false, error: { code: "upstream-error", message: "GitHub returned an unexpected repository record." } };
  if (repoInfo.data.private) return { ok: false, error: { code: "private", message: `${owner}/${repo} is private. Only public repositories can be analyzed.` } };
  if (repoInfo.data.size * 1024 > limits.maxRepositoryBytes) return { ok: false, error: { code: "too-large", message: `${owner}/${repo} is about ${Math.round(repoInfo.data.size / 1024)} MB; the hosted analysis accepts repositories up to ${Math.round(limits.maxRepositoryBytes / 1024 / 1024)} MB. Run the CLI locally for larger projects.` } };

  // 2. Resolve the ref to a commit so the archive, the cache key and the report agree.
  const wanted = ref ?? repoInfo.data.default_branch;
  const commit = await api(`/repos/${owner}/${repo}/commits/${encodeURIComponent(wanted)}`);
  if (commit.kind === "network") return { ok: false, error: { code: signal.aborted ? "timeout" : "upstream-error", message: `GitHub could not be reached: ${commit.message}` } };
  if (commit.status === 404 || commit.status === 422) return { ok: false, error: { code: "ref-not-found", message: `Branch, tag or commit "${wanted}" was not found in ${owner}/${repo}.` } };
  if (commit.status !== 200) return { ok: false, error: { code: "upstream-error", message: `GitHub answered HTTP ${commit.status} for the commit.` } };
  const commitInfo = commitSchema.safeParse(commit.json);
  if (!commitInfo.success) return { ok: false, error: { code: "upstream-error", message: "GitHub returned an unexpected commit record." } };
  return { ok: true, value: { owner, repo, ref, sha: commitInfo.data.sha, defaultBranch: repoInfo.data.default_branch, htmlUrl: repoInfo.data.html_url } };
}

export async function scanGitHubRepository(options: ServiceOptions): Promise<ServiceResult> {
  const started = Date.now();
  const limits: ServiceLimits = { ...DEFAULT_SERVICE_LIMITS, ...options.limits, tar: { ...DEFAULT_TAR_LIMITS, ...options.limits?.tar } };
  const fetchFn = options.fetch ?? globalThis.fetch;
  const archiveBase = (options.archiveBase ?? "https://codeload.github.com").replace(/\/$/, "");
  const ua = options.userAgent ?? UA;

  const parsed = parseGitHubRepoUrl(options.url);
  if (!parsed.ok) return { ok: false, error: { code: "invalid-url", message: parsed.reason } };
  const { owner, repo, ref } = parsed.value;

  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, limits.totalTimeoutMs);
  const api = githubApi(options, controller.signal);

  try {
    // 1-2. Existence, visibility, size and commit, unless the caller resolved them already.
    let resolved: ResolvedRepository;
    if (options.resolved?.owner === owner && options.resolved.repo === repo) {
      resolved = options.resolved;
    } else {
      const r = await resolveWith(api, controller.signal, owner, repo, ref, limits);
      if (!r.ok) return r;
      resolved = r.value;
    }
    const sha = resolved.sha;

    // 3. Download the archive for that exact commit.
    const dlStart = Date.now();
    let gz: Buffer | null;
    try {
      const res = await fetchFn(`${archiveBase}/${owner}/${repo}/tar.gz/${sha}`, { headers: { "user-agent": ua }, signal: controller.signal, redirect: "follow" });
      if (res.status !== 200) return { ok: false, error: { code: "download-failed", message: `GitHub answered HTTP ${res.status} for the archive.` } };
      gz = await readLimited(res, limits.maxDownloadBytes);
    } catch (e) {
      return { ok: false, error: { code: controller.signal.aborted ? "timeout" : "download-failed", message: `The archive could not be downloaded: ${(e as Error).message}` } };
    }
    if (gz === null) return { ok: false, error: { code: "too-large", message: `The archive is larger than ${Math.round(limits.maxDownloadBytes / 1024 / 1024)} MB compressed. Run the CLI locally for larger projects.` } };
    const downloadMs = Date.now() - dlStart;

    // 4. Extract under limits into a fresh temporary directory.
    const work = join(options.workDir ?? tmpdir(), `gateseeker-web-${randomBytes(8).toString("hex")}`);
    mkdirSync(work, { recursive: true });
    try {
      const exStart = Date.now();
      const extracted = extractTarGz(gz, work, limits.tar);
      if (!extracted.ok) return { ok: false, error: { code: "archive-rejected", message: extracted.error.message } };
      const extractMs = Date.now() - exStart;

      // 5. The same engine, the same defaults, no baseline (there is no "before" on the web).
      if (controller.signal.aborted) return { ok: false, error: { code: "timeout", message: "The analysis took too long and was stopped." } };
      const scanStart = Date.now();
      const result = await scanDirectory({ ...options.scan, root: work });
      const scanMs = Date.now() - scanStart;
      if (!result.ok) return { ok: false, error: { code: "scan-failed", message: result.error.message } };
      // The temporary path is meaningless to the reader; present the repository instead.
      const report: Report = {
        ...result.report,
        project: {
          ...result.report.project,
          rootPath: `${owner}/${repo}@${sha.slice(0, 12)}`,
          lockfilePath: result.report.project.lockfilePath ? relativeTo(work, result.report.project.lockfilePath) : null,
          lockfiles: result.report.project.lockfiles.map((l) => ({ ...l, path: relativeTo(work, l.path) })),
        },
      };
      return {
        ok: true,
        value: {
          repository: resolved,
          archive: { files: extracted.value.files, bytes: extracted.value.bytes, skippedLarge: extracted.value.skippedLarge, sha256: extracted.value.sha256 },
          report,
          timings: { downloadMs, extractMs, scanMs, totalMs: Date.now() - started },
        },
      };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  } finally {
    clearTimeout(timer);
  }
}

function relativeTo(root: string, path: string): string {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = path.replace(/\\/g, "/");
  return normalized.startsWith(`${normalizedRoot}/`) ? normalized.slice(normalizedRoot.length + 1) : normalized;
}

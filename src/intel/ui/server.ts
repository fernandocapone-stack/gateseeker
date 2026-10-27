import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { validateAdvisory, type Advisory } from "../advisory-schema.js";
import { makeGitRunner, type GitRunner } from "./git.js";
import type { DecideRequest, DecideResponse, PushResponse, UiRecord, UiState } from "./types.js";

/**
 * Local triage server: serves the built UI and a small JSON API that reads
 * and writes advisories/ and commits each decision. Binds to 127.0.0.1 only,
 * requires a per-session token on every API call, and never runs git
 * commands outside the allowlist in ./git.ts.
 */

export interface UiServerOptions {
  root: string;
  uiDist?: string;
  token?: string;
  git?: GitRunner;
  now?: () => Date;
  /** Merge the newest open origin/intel/* branch into the current branch at start. */
  mergeIntel?: boolean;
}

export interface UiServer {
  server: Server;
  token: string;
  /** Resolved after start: the merged intel branch, if any. */
  mergedIntelBranch: string | null;
  warnings: string[];
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8"): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-src https:; connect-src 'self'",
  });
  res.end(text);
}

async function readJson(req: IncomingMessage, maxBytes = 512 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function listDir(root: string, dir: UiRecord["dir"]): Promise<{ records: UiRecord[]; warnings: string[] }> {
  const records: UiRecord[] = [];
  const warnings: string[] = [];
  const full = join(root, "advisories", dir);
  let names: string[];
  try {
    names = (await readdir(full)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return { records, warnings };
  }
  for (const n of names) {
    try {
      const json = JSON.parse(await readFile(join(full, n), "utf8")) as unknown;
      const v = validateAdvisory(json);
      if (v.ok) records.push({ id: v.advisory.id, file: n, dir, data: v.advisory });
      else warnings.push(`${dir}/${n}: ${v.issues.join("; ")}`);
    } catch (err) {
      warnings.push(`${dir}/${n}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { records, warnings };
}

export function createUiServer(options: UiServerOptions): UiServer {
  const root = resolve(options.root);
  const uiDist = options.uiDist ?? join(root, "ui", "dist");
  const token = options.token ?? randomBytes(24).toString("hex");
  const git = options.git ?? makeGitRunner(root);
  const now = options.now ?? (() => new Date());
  const state: UiServer = { server: undefined as unknown as Server, token, mergedIntelBranch: null, warnings: [] };

  async function gitUser(): Promise<string | null> {
    const r = await git(["config", "--get", "user.name"]);
    const name = r.stdout.trim();
    return r.code === 0 && name.length > 0 ? name : null;
  }

  async function branchName(): Promise<string | null> {
    const r = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async function unpushedCount(): Promise<number> {
    const r = await git(["rev-list", "--count", "@{u}..HEAD"]);
    return r.code === 0 ? Number(r.stdout.trim()) || 0 : 0;
  }

  async function buildState(): Promise<UiState> {
    const [pending, approved, rejected] = await Promise.all([listDir(root, "proposed"), listDir(root, "approved"), listDir(root, "rejected")]);
    return {
      gitUser: await gitUser(),
      branch: await branchName(),
      unpushed: await unpushedCount(),
      mergedIntelBranch: state.mergedIntelBranch,
      pending: pending.records,
      approved: approved.records,
      rejected: rejected.records,
      warnings: [...state.warnings, ...pending.warnings, ...approved.warnings, ...rejected.warnings],
    };
  }

  async function decide(body: DecideRequest): Promise<DecideResponse> {
    const current = (await listDir(root, "proposed")).records.find((r) => r.id === body.id);
    if (!current) return { ok: false, issues: [`${body.id} is not a pending record`] };

    const record: Advisory = { ...body.record, id: current.id };
    const reviewer = await gitUser();
    const stamp = now().toISOString();
    let targetDir: UiRecord["dir"] = "proposed";

    if (body.action === "approve") {
      record.status = "approved";
      record.review = { ...record.review, reviewed_by: reviewer ?? record.review.reviewed_by, reviewed_at: stamp };
      targetDir = "approved";
    } else if (body.action === "reject") {
      const reason = (body.reason ?? "").trim();
      if (reason.length === 0) return { ok: false, issues: ["a reason is required to reject"] };
      record.status = "rejected";
      record.review = {
        ...record.review,
        reviewed_by: reviewer ?? record.review.reviewed_by,
        reviewed_at: stamp,
        notes: [record.review.notes, `Rejected ${stamp.slice(0, 10)}: ${reason}`].filter((x): x is string => typeof x === "string" && x.length > 0).join(" ").slice(0, 500),
      };
      targetDir = "rejected";
    } else {
      record.status = "proposed";
    }
    if (targetDir !== "proposed") delete (record as { draft?: unknown }).draft;
    if (!reviewer && targetDir !== "proposed") return { ok: false, issues: ["git user.name is not configured; the reviewer cannot be recorded"] };

    const v = validateAdvisory(record);
    if (!v.ok) return { ok: false, issues: v.issues };

    const fromPath = join(root, "advisories", "proposed", current.file);
    const toPath = join(root, "advisories", targetDir, current.file);
    await mkdir(join(root, "advisories", targetDir), { recursive: true });
    await writeFile(fromPath, `${JSON.stringify(v.advisory, null, 2)}\n`, "utf8");
    if (toPath !== fromPath) {
      await rename(fromPath, toPath);
    }

    if (targetDir === "proposed") return { ok: true, dir: targetDir, file: current.file, commit: null };

    const add = await git(["add", "-A", "advisories"]);
    if (add.code !== 0) return { ok: false, issues: [`git add failed: ${add.stderr.trim()}`] };
    const message = `intel: ${body.action} ${record.id}\n\nReviewed by ${reviewer ?? "unknown"} through the Gateseeker triage interface.`;
    const commit = await git(["commit", "-q", "-m", message]);
    if (commit.code !== 0) return { ok: false, issues: [`git commit failed: ${commit.stderr.trim() || commit.stdout.trim()}`] };
    const sha = await git(["rev-parse", "--short", "HEAD"]);
    return { ok: true, dir: targetDir, file: current.file, commit: sha.code === 0 ? sha.stdout.trim() : null };
  }

  async function push(): Promise<PushResponse> {
    const r = await git(["push"]);
    return r.code === 0 ? { ok: true, output: (r.stdout + r.stderr).trim() } : { ok: false, error: (r.stderr || r.stdout).trim() };
  }

  async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(uiDist, rel === "/" || rel === "\\" ? "index.html" : rel);
    if (!filePath.startsWith(resolve(uiDist))) {
      send(res, 403, { error: "forbidden" });
      return;
    }
    try {
      const st = await stat(filePath);
      if (st.isDirectory()) filePath = join(filePath, "index.html");
    } catch {
      filePath = join(uiDist, "index.html"); // SPA fallback
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(body);
    } catch {
      send(res, 404, "The UI is not built. Run `pnpm build` (or `pnpm --filter ui build`) and start again.", "text/plain; charset=utf-8");
    }
  }

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        if (req.headers["x-gateseeker-token"] !== token) {
          send(res, 401, { error: "missing or invalid session token" });
          return;
        }
        try {
          if (req.method === "GET" && url.pathname === "/api/state") {
            send(res, 200, await buildState());
          } else if (req.method === "POST" && url.pathname === "/api/decide") {
            const body = (await readJson(req)) as DecideRequest;
            const result = await decide(body);
            send(res, result.ok ? 200 : 422, result);
          } else if (req.method === "POST" && url.pathname === "/api/push") {
            const result = await push();
            send(res, result.ok ? 200 : 502, result);
          } else {
            send(res, 404, { error: "not found" });
          }
        } catch (err) {
          send(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      await serveStatic(url.pathname, res);
    })();
  });

  state.server = server;

  // Optional: bring in the newest open intel branch so its proposals are reviewable.
  if (options.mergeIntel) {
    void (async () => {
      const fetch = await git(["fetch", "origin", "--prune"]);
      if (fetch.code !== 0) {
        state.warnings.push(`git fetch failed: ${fetch.stderr.trim()}`);
        return;
      }
      const branches = await git(["branch", "-r", "--list", "origin/intel/*"]);
      const names = branches.stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0).sort();
      const newest = names[names.length - 1];
      if (!newest) return;
      const merge = await git(["merge", "--no-edit", newest]);
      if (merge.code === 0) state.mergedIntelBranch = newest;
      else state.warnings.push(`could not merge ${newest}: ${(merge.stderr || merge.stdout).trim()}`);
    })();
  }

  return state;
}

export async function removeIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    /* ignore */
  }
}

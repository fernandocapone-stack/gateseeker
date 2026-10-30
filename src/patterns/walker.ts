import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { classifyFile, detectProjectKind, extensionOf } from "./classify.js";
import { makeGitignoreMatcher } from "./gitignore.js";
import type { ProjectFile, ProjectSnapshot, WalkStats } from "./types.js";

/**
 * Walks a project directory and produces a ProjectSnapshot.
 *
 * Safety properties:
 *  - symbolic links are never followed;
 *  - every path is checked to stay under the root;
 *  - fixed exclusions plus the root .gitignore are skipped;
 *  - binary files are skipped (by extension, then by a NUL probe);
 *  - limits on file count, file size and depth abort the walk with a typed error.
 */

export interface WalkLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxDepth: number;
}

export const DEFAULT_WALK_LIMITS: WalkLimits = {
  maxFiles: 5000,
  maxFileBytes: 1024 * 1024,
  maxDepth: 20,
};

export const ALWAYS_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  "out",
  "coverage",
  "vendor",
  ".turbo",
  ".vercel",
  ".netlify",
  ".cache",
  ".parcel-cache",
  "__pycache__",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp", ".svgz",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov", ".avi",
  ".zip", ".gz", ".tgz", ".tar", ".7z", ".rar", ".br",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".wasm", ".exe", ".dll", ".so", ".dylib", ".bin", ".class", ".jar",
  ".lock", ".lockb", ".map", ".min.js", ".min.css",
  ".sqlite", ".db", ".psd", ".ai", ".sketch", ".fig",
]);

export type WalkErrorCode = "root-not-directory" | "too-many-files" | "too-deep" | "unreadable";

export interface WalkError {
  code: WalkErrorCode;
  message: string;
}

export type WalkResult = { ok: true; project: ProjectSnapshot } | { ok: false; error: WalkError };

function isBinaryByExtension(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".min.js") || lower.endsWith(".min.css")) return true;
  return BINARY_EXT.has(extensionOf(lower));
}

function looksBinary(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(buf.length, 8000));
  return probe.includes(0);
}

export async function walkProject(rootInput: string, limits: WalkLimits = DEFAULT_WALK_LIMITS): Promise<WalkResult> {
  const root = resolve(rootInput);
  let rootStat;
  try {
    rootStat = await lstat(root);
  } catch (err) {
    return { ok: false, error: { code: "unreadable", message: `Cannot read ${root}: ${err instanceof Error ? err.message : String(err)}` } };
  }
  if (!rootStat.isDirectory()) {
    return { ok: false, error: { code: "root-not-directory", message: `${root} is not a directory.` } };
  }

  let gitignoreText: string | null;
  try {
    gitignoreText = await readFile(join(root, ".gitignore"), "utf8");
  } catch {
    gitignoreText = null;
  }
  const isGitignored = makeGitignoreMatcher(gitignoreText);

  const stats: WalkStats = { filesScanned: 0, filesSkippedIgnored: 0, filesSkippedBinary: 0, filesSkippedLarge: 0, largeFiles: [], bytesScanned: 0, directoriesVisited: 0 };
  const rawFiles: { rel: string; abs: string; size: number }[] = [];

  // Iterative DFS to control depth without recursion surprises.
  const stack: { abs: string; depth: number }[] = [{ abs: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (current.depth > limits.maxDepth) {
      return { ok: false, error: { code: "too-deep", message: `Directory nesting exceeds ${limits.maxDepth} levels at ${relative(root, current.abs)}.` } };
    }
    stats.directoriesVisited++;

    let entries;
    try {
      entries = await readdir(current.abs, { withFileTypes: true });
    } catch {
      continue; // unreadable directory: skip, do not fail the whole scan
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const abs = join(current.abs, entry.name);
      const rel = relative(root, abs).split(sep).join("/");

      if (entry.isSymbolicLink()) {
        stats.filesSkippedIgnored++;
        continue;
      }
      // Containment check: never leave the root.
      if (rel.startsWith("..") || resolve(abs) !== abs) {
        stats.filesSkippedIgnored++;
        continue;
      }

      if (entry.isDirectory()) {
        if (ALWAYS_IGNORED_DIRS.has(entry.name) || isGitignored(`${rel}/`) || isGitignored(rel)) {
          stats.filesSkippedIgnored++;
          continue;
        }
        stack.push({ abs, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;

      // .gitignore itself and .env files are kept even when gitignored: the
      // ENV rule needs to see them. Everything else gitignored is skipped.
      const keepAnyway = entry.name === ".gitignore" || entry.name === ".env" || entry.name.startsWith(".env.");
      if (!keepAnyway && isGitignored(rel)) {
        stats.filesSkippedIgnored++;
        continue;
      }
      if (isBinaryByExtension(entry.name)) {
        stats.filesSkippedBinary++;
        continue;
      }

      let st;
      try {
        st = await lstat(abs);
      } catch {
        continue;
      }
      // Above the limit: skipped and listed, not fatal (PO decision 2026-10-30, docs/VALIDATION_SPRINT_5.md).
      // These are generated files, bundles and binaries; the report says which ones were not read.
      if (st.size > limits.maxFileBytes) {
        stats.filesSkippedLarge++;
        if (stats.largeFiles.length < 10) stats.largeFiles.push(rel);
        continue;
      }
      rawFiles.push({ rel, abs, size: st.size });
      if (rawFiles.length > limits.maxFiles) {
        return { ok: false, error: { code: "too-many-files", message: `Project has more than ${limits.maxFiles} files to scan.` } };
      }
    }
  }

  const rootNames = rawFiles.filter((f) => !f.rel.includes("/")).map((f) => f.rel);
  const kind = detectProjectKind(rootNames);

  const files: ProjectFile[] = [];
  for (const f of rawFiles) {
    let buf: Buffer;
    try {
      buf = await readFile(f.abs);
    } catch {
      continue;
    }
    if (looksBinary(buf)) {
      stats.filesSkippedBinary++;
      continue;
    }
    const content = buf.toString("utf8");
    files.push({
      path: f.rel,
      size: f.size,
      fileClass: classifyFile(f.rel, content, kind),
      content,
      lines: content.split(/\r?\n/),
    });
    stats.filesScanned++;
    stats.bytesScanned += f.size;
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    ok: true,
    project: {
      root,
      kind,
      files,
      byPath: new Map(files.map((f) => [f.path, f])),
      isGitignored,
      stats,
    },
  };
}

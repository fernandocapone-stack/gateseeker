import type { FileClass, ProjectKind } from "./types.js";

/**
 * Path-and-content based file classification. The heuristics are deliberately
 * simple and documented in docs/ARCHITECTURE.md; the resulting class is stored
 * on every finding so a reader can see why a rule did or did not apply.
 */

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro"]);
const TEST_SEGMENTS = new Set(["__tests__", "__mocks__", "test", "tests", "spec", "specs", "e2e", "fixtures", "cypress", "playwright", "stories"]);
const SERVER_SEGMENTS = new Set(["api", "server", "backend", "functions", "scripts", "workers", "edge-functions", "netlify", "lambda", "jobs", "cron"]);
const CLIENT_SEGMENTS = new Set(["components", "hooks", "pages", "app", "views", "ui", "public", "layouts", "store", "stores", "features"]);

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function detectProjectKind(rootFiles: Iterable<string>): ProjectKind {
  const names = new Set(rootFiles);
  for (const n of names) {
    if (/^next\.config\.(js|mjs|cjs|ts)$/.test(n)) return "next";
  }
  for (const n of names) {
    if (/^vite\.config\.(js|mjs|cjs|ts|mts)$/.test(n)) return "vite";
  }
  return "unknown";
}

function hasUseClientDirective(content: string): boolean {
  // Directive must appear before any code; checking the first 300 chars is enough.
  return /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*["']use client["']/.test(content.slice(0, 300));
}

export function classifyFile(relPath: string, content: string, kind: ProjectKind): FileClass {
  const path = relPath.replace(/\\/g, "/");
  const segments = path.split("/");
  const dirs = segments.slice(0, -1);
  const base = basenameOf(path);
  const ext = extensionOf(path);
  const lowerBase = base.toLowerCase();

  if (dirs.some((d) => TEST_SEGMENTS.has(d.toLowerCase())) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(lowerBase) || /\.stories\.[jt]sx?$/.test(lowerBase)) {
    return "test";
  }
  if (lowerBase === ".env" || lowerBase.startsWith(".env.")) return "env";
  if (ext === ".sql") return "sql";
  if (lowerBase === "firestore.rules" || lowerBase === "storage.rules" || lowerBase === "database.rules.json") return "rules";
  if (
    /^(next|vite|vitest|jest|tailwind|postcss|eslint|prettier|playwright|astro|nuxt|svelte|remix|webpack|rollup|tsup|drizzle)\.config\.[cm]?[jt]sx?$/.test(lowerBase) ||
    lowerBase === "vercel.json" ||
    lowerBase === "netlify.toml" ||
    lowerBase === "package.json" ||
    lowerBase === "firebase.json" ||
    lowerBase === "supabase/config.toml" ||
    /^tsconfig.*\.json$/.test(lowerBase) ||
    lowerBase === ".gitignore"
  ) {
    return "config";
  }

  if (!CODE_EXT.has(ext)) return "other";

  // Server-side code by convention.
  if (
    /(^|\/)pages\/api\//.test(path) ||
    /(^|\/)app\/.*\/route\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)middleware\.[cm]?[jt]s$/.test(path) ||
    /(^|\/)supabase\/functions\//.test(path) ||
    /\.server\.[cm]?[jt]sx?$/.test(lowerBase) ||
    dirs.some((d) => SERVER_SEGMENTS.has(d.toLowerCase())) ||
    /(^|\/)lib\/server\//.test(path)
  ) {
    return "server";
  }

  if (hasUseClientDirective(content)) return "client";

  // Vite / CRA style single-page apps: everything under src/ ships to the browser.
  if (kind === "vite" && segments[0] === "src") return "client";

  if (ext === ".tsx" || ext === ".jsx" || ext === ".vue" || ext === ".svelte" || ext === ".astro") return "client";
  if (dirs.some((d) => CLIENT_SEGMENTS.has(d.toLowerCase()))) return "client";

  return "other";
}

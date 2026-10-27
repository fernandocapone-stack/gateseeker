import { sanitize } from "../../report/text.js";
import type { ProjectSnapshot, Rule, RuleMatch } from "../types.js";

/**
 * GSK-SUPABASE-001: a table created in Supabase migrations never has Row Level
 * Security enabled (or has it disabled later). With Supabase's auto-generated
 * REST API, such a table is readable and writable by anyone holding the public
 * anon key, which every browser client has.
 */

const CREATE_TABLE_RE = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?("?[\w]+"?\.)?("?[\w]+"?)/gi;
const ENABLE_RLS_RE = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?("?[\w]+"?\.)?("?[\w]+"?)\s+enable\s+row\s+level\s+security/gi;
const DISABLE_RLS_RE = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?("?[\w]+"?\.)?("?[\w]+"?)\s+disable\s+row\s+level\s+security/gi;

/** Schemas Supabase does not expose through PostgREST by default. */
const UNEXPOSED_SCHEMAS = new Set(["auth", "storage", "extensions", "private", "realtime", "vault", "supabase_functions", "graphql", "graphql_public", "pgsodium", "net", "cron", "internal"]);

function normalizeName(schema: string | undefined, name: string): { schema: string; table: string } {
  const strip = (s: string): string => s.replace(/"/g, "").toLowerCase();
  return { schema: schema ? strip(schema.replace(/\.$/, "")) : "public", table: strip(name) };
}

function isSupabaseSql(path: string): boolean {
  return /(^|\/)supabase\/.*\.sql$/i.test(path) || /(^|\/)migrations\/.*\.sql$/i.test(path);
}

interface RlsIndex {
  enabled: Set<string>;
  /** Tables with a DISABLE after their last ENABLE (by file order, which is migration order). */
  disabledAfter: Set<string>;
}

const indexCache = new WeakMap<ProjectSnapshot, RlsIndex>();

function indexRls(project: ProjectSnapshot): RlsIndex {
  const cached = indexCache.get(project);
  if (cached) return cached;
  const enabled = new Set<string>();
  const disabledAfter = new Set<string>();
  // Files are sorted by path; Supabase migrations are timestamp-prefixed, so
  // path order is application order.
  for (const file of project.files) {
    if (file.fileClass !== "sql" || !isSupabaseSql(file.path)) continue;
    const text = stripSqlComments(file.content);
    for (const m of text.matchAll(ENABLE_RLS_RE)) {
      const { schema, table } = normalizeName(m[1], m[2] ?? "");
      enabled.add(`${schema}.${table}`);
      disabledAfter.delete(`${schema}.${table}`);
    }
    for (const m of text.matchAll(DISABLE_RLS_RE)) {
      const { schema, table } = normalizeName(m[1], m[2] ?? "");
      disabledAfter.add(`${schema}.${table}`);
    }
  }
  const idx = { enabled, disabledAfter };
  indexCache.set(project, idx);
  return idx;
}

export function stripSqlComments(sql: string): string {
  // Preserve line structure so line numbers stay correct.
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

export const supabaseRlsRule: Rule = {
  id: "GSK-SUPABASE-001",
  title: "Supabase table created without Row Level Security",
  severity: "HIGH",
  description: "A table in an exposed schema is created in a migration and no migration enables Row Level Security on it, or a later migration disables it.",
  action: "Add `alter table <schema>.<table> enable row level security;` in a migration and define policies for the intended access. Until then the table is fully readable and writable with the public anon key.",
  appliesTo: (file) => file.fileClass === "sql" && isSupabaseSql(file.path),
  check: ({ file, project }) => {
    const idx = indexRls(project);
    const text = stripSqlComments(file.content);
    const matches: RuleMatch[] = [];
    const reported = new Set<string>();
    for (const m of text.matchAll(CREATE_TABLE_RE)) {
      const { schema, table } = normalizeName(m[1], m[2] ?? "");
      if (UNEXPOSED_SCHEMAS.has(schema)) continue;
      const key = `${schema}.${table}`;
      if (reported.has(key)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      if (idx.disabledAfter.has(key)) {
        reported.add(key);
        matches.push({ line, snippet: sanitize((file.lines[line - 1] ?? "").trim(), 160), message: `Row Level Security is explicitly disabled on ${key} in a later migration.`, details: { table: key, state: "disabled" } });
      } else if (!idx.enabled.has(key)) {
        reported.add(key);
        matches.push({ line, snippet: sanitize((file.lines[line - 1] ?? "").trim(), 160), message: `No migration enables Row Level Security on ${key}.`, details: { table: key, state: "never-enabled" } });
      }
    }
    return matches;
  },
};

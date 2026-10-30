import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanReason, suppressionComment } from "../src/patterns/suppression.js";
import { scanDirectory } from "../src/scan.js";

/**
 * The comment the web's "Accept the risk" helper writes must be one the
 * engine reads (docs/SPRINT_5.md test 4): written above a real finding, the
 * next scan reports it as suppressed with the reason, and nothing else.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "gsk-suppress-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

async function patternsOf(root: string) {
  const r = await scanDirectory({ root, only: "patterns", now: () => new Date("2026-10-29T12:00:00Z") });
  if (!r.ok) throw new Error(r.error.message);
  return r.report;
}

describe("suppressionComment", () => {
  it("uses the comment syntax of the file type", () => {
    expect(suppressionComment("src/server.ts", "GSK-CORS-001", "public webhook")).toBe("// gateseeker-ignore GSK-CORS-001 public webhook");
    expect(suppressionComment("supabase/migrations/1.sql", "GSK-SUPABASE-001", "lookup table")).toBe("-- gateseeker-ignore GSK-SUPABASE-001 lookup table");
    expect(suppressionComment(".env.local", "GSK-SECRET-002", "test key")).toBe("# gateseeker-ignore GSK-SECRET-002 test key");
    expect(suppressionComment("styles/a.css", "GSK-X-001", "why")).toBe("/* gateseeker-ignore GSK-X-001 why */");
    expect(suppressionComment("index.html", "GSK-X-001", "why")).toBe("<!-- gateseeker-ignore GSK-X-001 why -->");
  });

  it("refuses JSON (no comments), malformed rule ids and empty reasons", () => {
    expect(suppressionComment("database.rules.json", "GSK-FIREBASE-001", "why")).toBeNull();
    expect(suppressionComment("a.ts", "GSK-CORS-1; rm", "why")).toBeNull();
    expect(suppressionComment("a.ts", "GSK-CORS-001", "  \n ")).toBeNull();
  });

  it("keeps the reason on one line and unable to close the comment", () => {
    expect(cleanReason("ok */ then\ncode() <!-- x --> y")).toBe("ok  then code() <!-- x  y");
    expect(suppressionComment("a.css", "GSK-X-001", "a */ b")).toBe("/* gateseeker-ignore GSK-X-001 a  b */");
    expect(cleanReason("x".repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe("round trip with the engine", () => {
  it("suppresses a code finding when the comment is pasted on the line above", async () => {
    const code = 'import cors from "cors";\napp.use(cors({ origin: "*", credentials: true }));\n';
    const before = await patternsOf(project({ "src/server.ts": code }));
    const f = before.findings.find((x) => x.evidence.kind === "insecure-pattern" && x.evidence.ruleId === "GSK-CORS-001");
    expect(f).toBeDefined();
    if (f?.evidence.kind !== "insecure-pattern") return;

    const comment = suppressionComment(f.evidence.file, f.evidence.ruleId, "internal tool behind VPN, no browser users") ?? "";
    const lines = code.split("\n");
    lines.splice(f.evidence.line - 1, 0, comment);
    const after = await patternsOf(project({ "src/server.ts": lines.join("\n") }));
    expect(after.findings.some((x) => x.evidence.kind === "insecure-pattern" && x.evidence.ruleId === "GSK-CORS-001")).toBe(false);
    expect(after.patterns?.suppressions).toEqual([{ file: "src/server.ts", line: f.evidence.line, ruleId: "GSK-CORS-001", reason: "internal tool behind VPN, no browser users" }]);
    expect(after.patterns?.invalidSuppressions).toEqual([]);
  });

  it("suppresses a migration finding with an SQL comment", async () => {
    const sql = "create table public.countries (code text primary key, name text);\n";
    const before = await patternsOf(project({ "supabase/migrations/20260101000000_init.sql": sql }));
    const f = before.findings.find((x) => x.evidence.kind === "insecure-pattern" && x.evidence.ruleId === "GSK-SUPABASE-001");
    expect(f).toBeDefined();
    if (f?.evidence.kind !== "insecure-pattern") return;
    const comment = suppressionComment(f.evidence.file, "GSK-SUPABASE-001", "read-only reference data, no user rows") ?? "";
    const lines = sql.split("\n");
    lines.splice(f.evidence.line - 1, 0, comment);
    const after = await patternsOf(project({ "supabase/migrations/20260101000000_init.sql": lines.join("\n") }));
    expect(after.findings.filter((x) => x.evidence.kind === "insecure-pattern" && x.evidence.ruleId === "GSK-SUPABASE-001")).toEqual([]);
    expect(after.patterns?.suppressions[0]?.reason).toBe("read-only reference data, no user rows");
  });
});

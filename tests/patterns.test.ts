import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyFile, detectProjectKind } from "../src/patterns/classify.js";
import { runRules } from "../src/patterns/engine.js";
import { makeGitignoreMatcher } from "../src/patterns/gitignore.js";
import { entropyBitsPerChar, looksLikePlaceholder, maskQuotedLiterals, redactEnvLine, redactInLine, redactSecret } from "../src/patterns/redact.js";
import { RULES } from "../src/patterns/rules/index.js";
import { SECRET_PATTERNS, decodeJwtRole } from "../src/patterns/rules/secret-hardcoded.js";
import { isSuspiciousPublicVar } from "../src/patterns/rules/secret-public-env.js";
import { stripSqlComments } from "../src/patterns/rules/supabase-rls.js";
import { DEFAULT_WALK_LIMITS, walkProject } from "../src/patterns/walker.js";
import { scanDirectory } from "../src/scan.js";
import type { Finding } from "../src/types.js";
import { fixturePath, readFixture, readJsonFixture } from "./helpers.js";

const VIBE = fixturePath("projects/vibe-next-supabase");
const CLEAN = fixturePath("projects/clean-vite");
const SECRETS = readJsonFixture("projects/secrets.json") as Record<string, string>;
const fixedNow = () => new Date("2026-10-27T12:00:00.000Z");

async function patternFindings(root: string): Promise<{ findings: Finding[]; summary: NonNullable<Awaited<ReturnType<typeof runRules>>["summary"]> }> {
  const walked = await walkProject(root);
  if (!walked.ok) throw new Error(walked.error.message);
  return runRules(walked.project, RULES, fixedNow);
}

function byRule(findings: Finding[], ruleId: string): Finding[] {
  return findings.filter((f) => f.evidence.kind === "insecure-pattern" && f.evidence.ruleId === ruleId);
}

function subjects(findings: Finding[]): string[] {
  return findings.map((f) => f.subject).sort();
}

describe("gitignore matcher", () => {
  const ignored = makeGitignoreMatcher("node_modules/\n.env\n.env.*\n!.env.example\n/dist\nbuild/\n*.log\ndocs/**/draft.md\n# comment\n");
  it("matches common patterns", () => {
    expect(ignored("node_modules/x/index.js")).toBe(true);
    expect(ignored("packages/a/node_modules/x")).toBe(true);
    expect(ignored(".env")).toBe(true);
    expect(ignored(".env.local")).toBe(true);
    expect(ignored("dist/app.js")).toBe(true);
    expect(ignored("src/dist/app.js")).toBe(false); // anchored
    expect(ignored("build/out.js")).toBe(true);
    expect(ignored("logs/app.log")).toBe(true);
    expect(ignored("docs/a/b/draft.md")).toBe(true);
    expect(ignored("src/index.ts")).toBe(false);
  });
  it("ignores negations (documented limitation) and handles a missing file", () => {
    expect(ignored(".env.example")).toBe(true);
    expect(makeGitignoreMatcher(null)("anything")).toBe(false);
  });
});

describe("classifyFile", () => {
  it("detects the project kind from root files", () => {
    expect(detectProjectKind(["next.config.mjs", "package.json"])).toBe("next");
    expect(detectProjectKind(["vite.config.ts"])).toBe("vite");
    expect(detectProjectKind(["package.json"])).toBe("unknown");
  });
  it("classifies by path and content", () => {
    expect(classifyFile("__tests__/a.ts", "", "next")).toBe("test");
    expect(classifyFile("src/a.test.tsx", "", "vite")).toBe("test");
    expect(classifyFile(".env.production", "", "next")).toBe("env");
    expect(classifyFile("supabase/migrations/1.sql", "", "next")).toBe("sql");
    expect(classifyFile("firestore.rules", "", "next")).toBe("rules");
    expect(classifyFile("database.rules.json", "", "next")).toBe("rules");
    expect(classifyFile("next.config.mjs", "", "next")).toBe("config");
    expect(classifyFile("vercel.json", "", "next")).toBe("config");
    expect(classifyFile("app/api/x/route.ts", "", "next")).toBe("server");
    expect(classifyFile("pages/api/x.ts", "", "next")).toBe("server");
    expect(classifyFile("middleware.ts", "", "next")).toBe("server");
    expect(classifyFile("supabase/functions/f/index.ts", "", "next")).toBe("server");
    expect(classifyFile("lib/a.ts", "'use client';\nexport {}", "next")).toBe("client");
    expect(classifyFile("lib/a.ts", "// comment\n\"use client\"\n", "next")).toBe("client");
    expect(classifyFile("lib/a.ts", "export const x = 'use client';", "next")).toBe("other");
    expect(classifyFile("components/A.tsx", "", "next")).toBe("client");
    expect(classifyFile("src/lib/supabase.ts", "", "vite")).toBe("client");
    expect(classifyFile("src/lib/supabase.ts", "", "next")).toBe("other");
    expect(classifyFile("README.md", "", "next")).toBe("other");
  });
});

describe("redaction helpers", () => {
  it("redacts to prefix and length", () => {
    expect(redactSecret("sk_live_abcdefghijklmnop")).toBe("sk_l…[24 chars]");
    expect(redactInLine("const k = 'sk_live_abcdefghijklmnop';", ["sk_live_abcdefghijklmnop"])).toBe("const k = 'sk_l…[24 chars]';");
    expect(redactEnvLine("STRIPE_SECRET_KEY=\"sk_live_abc\"")).toBe("STRIPE_SECRET_KEY=<redacted 11 chars>");
    expect(redactEnvLine("EMPTY=")).toBe("EMPTY=");
  });
  it("measures entropy and spots placeholders", () => {
    expect(entropyBitsPerChar("aaaaaaaa")).toBe(0);
    expect(entropyBitsPerChar("abcdefgh")).toBe(3);
    expect(looksLikePlaceholder("sk_live_xxxxxxxxxxxxxxxx")).toBe(true);
    expect(looksLikePlaceholder("your-key-here")).toBe(true);
    expect(looksLikePlaceholder("<SECRET>")).toBe(true);
    expect(looksLikePlaceholder("AKIAQ7ZK3M9PL2XVB4NW")).toBe(false);
  });
  it("decodes JWT roles without trusting the signature", () => {
    expect(decodeJwtRole(SECRETS["service_role"] ?? "")).toBe("service_role");
    expect(decodeJwtRole(SECRETS["anon"] ?? "")).toBe("anon");
    expect(decodeJwtRole("not.a.jwt")).toBeNull();
    expect(decodeJwtRole("a.b")).toBeNull();
  });
});

describe("walker", () => {
  it("skips always-ignored dirs, gitignored paths, binaries; keeps .env and .gitignore", async () => {
    const walked = await walkProject(VIBE);
    expect(walked.ok).toBe(true);
    if (!walked.ok) return;
    const paths = walked.project.files.map((f) => f.path);
    expect(paths).not.toContain("node_modules/evil-pkg/index.js");
    expect(paths).not.toContain("public/blob.dat"); // NUL probe
    expect(paths).toContain(".env");
    expect(paths).toContain(".env.local"); // gitignored, but kept on purpose
    expect(paths).toContain(".gitignore");
    expect(walked.project.kind).toBe("next");
    expect(walked.project.stats.filesSkippedBinary).toBe(1);
    expect(walked.project.stats.filesSkippedIgnored).toBeGreaterThanOrEqual(1);
    expect(walked.project.isGitignored(".env.local")).toBe(true);
    expect(walked.project.isGitignored(".env")).toBe(false);
  });

  it("rejects a non-directory root", async () => {
    const r = await walkProject(fixturePath("lockfiles/v1.package-lock.json"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("root-not-directory");
  });

  it("aborts on too many files and on an oversize text file", async () => {
    const many = await walkProject(VIBE, { ...DEFAULT_WALK_LIMITS, maxFiles: 3 });
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.error.code).toBe("too-many-files");

    const big = await walkProject(VIBE, { ...DEFAULT_WALK_LIMITS, maxFileBytes: 200 });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.error.code).toBe("file-too-large");
  });

  it("aborts when nesting exceeds the depth limit", async () => {
    const r = await walkProject(VIBE, { ...DEFAULT_WALK_LIMITS, maxDepth: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too-deep");
  });

  it("does not follow symbolic links", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gateseeker-walk-"));
    try {
      await mkdir(join(dir, "src"));
      await writeFile(join(dir, "src", "a.ts"), "export const a = 1;\n");
      let linked = true;
      try {
        await symlink(fixturePath("projects"), join(dir, "escape"), "dir");
      } catch {
        linked = false; // symlinks may need privileges on Windows; the test still checks the normal walk
      }
      const r = await walkProject(dir);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.project.files.map((f) => f.path)).toEqual(["src/a.ts"]);
      if (linked) expect(r.project.stats.filesSkippedIgnored).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("rules on the vibe-next-supabase fixture", () => {
  it("GSK-SECRET-001 finds hardcoded credentials and ignores tests, examples, node_modules and binaries", async () => {
    const { findings } = await patternFindings(VIBE);
    const f = byRule(findings, "GSK-SECRET-001");
    expect(subjects(f)).toEqual([".env:2", ".env:3", "lib/aws.ts:1", "lib/aws.ts:2", "lib/aws.ts:3", "lib/stripe.ts:4"]);
    const types = f.map((x) => (x.evidence.kind === "insecure-pattern" ? x.evidence.details?.["secretType"] : null)).sort();
    expect(types).toEqual(["anthropic-api-key", "aws-access-key-id", "github-token", "stripe-live-secret-key", "stripe-live-secret-key", "supabase-service-role-jwt"]);
    for (const x of f) {
      expect(x.priority).toBe("P1");
      expect(x.severity.tier).toBe("CRITICAL");
      expect(x.rationale[0]).toBe("rule:GSK-SECRET-001");
    }
  });

  it("GSK-SECRET-002 flags secret-named public vars and allows public ones", async () => {
    const { findings } = await patternFindings(VIBE);
    const f = byRule(findings, "GSK-SECRET-002");
    expect(subjects(f)).toEqual([".env:6", "lib/mailer.ts:3"]);
    const snippets = Object.fromEntries(f.map((x) => [x.subject, x.evidence.kind === "insecure-pattern" ? x.evidence.snippet : ""]));
    expect(snippets[".env:6"]).toBe("NEXT_PUBLIC_STRIPE_SECRET_KEY=<redacted 36 chars>");
    // A hardcoded fallback value next to the variable is masked, the variable name stays visible.
    expect(snippets["lib/mailer.ts:3"]).toBe("auth: { user: process.env.SMTP_USER, pass: process.env.NEXT_PUBLIC_SMTP_PASSWORD || '<redacted 29 chars>' },");
    expect(isSuspiciousPublicVar("NEXT_PUBLIC_SUPABASE_ANON_KEY")).toBe(false);
    expect(isSuspiciousPublicVar("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")).toBe(false);
    expect(isSuspiciousPublicVar("VITE_OPENAI_API_KEY")).toBe(true);
    expect(isSuspiciousPublicVar("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")).toBe(true);
    expect(isSuspiciousPublicVar("NEXT_PUBLIC_MAPBOX_TOKEN")).toBe(false);
    expect(isSuspiciousPublicVar("NEXT_PUBLIC_SITE_URL")).toBe(false);
    expect(isSuspiciousPublicVar("DATABASE_PASSWORD")).toBe(false); // no public prefix
  });

  it("GSK-SUPABASE-001 reports tables without RLS and tables disabled later, skipping auth schema", async () => {
    const { findings } = await patternFindings(VIBE);
    const f = byRule(findings, "GSK-SUPABASE-001");
    expect(subjects(f)).toEqual(["supabase/migrations/20260101000000_init.sql:14", "supabase/migrations/20260101000000_init.sql:7"]);
    const states: Record<string, unknown> = {};
    for (const x of f) {
      if (x.evidence.kind === "insecure-pattern") states[String(x.evidence.details?.["table"])] = x.evidence.details?.["state"];
    }
    expect(states).toEqual({ "public.posts": "never-enabled", "public.comments": "disabled" });
    expect(f.every((x) => x.priority === "P1" && x.severity.tier === "HIGH")).toBe(true);
    expect(stripSqlComments("a -- b\nc /* d\ne */ f")).toBe("a \nc     \n     f");
  });

  it("GSK-SUPABASE-002 flags service_role in client code only", async () => {
    const { findings } = await patternFindings(VIBE);
    const f = byRule(findings, "GSK-SUPABASE-002");
    expect(subjects(f)).toEqual(["components/AdminPanel.tsx:6"]);
    expect(f[0]?.priority).toBe("P1");
  });

  it("GSK-FIREBASE-001 flags open Firestore and RTDB rules with write-aware severity", async () => {
    const { findings } = await patternFindings(VIBE);
    const f = byRule(findings, "GSK-FIREBASE-001");
    expect(subjects(f)).toEqual(["database.rules.json:3", "firestore.rules:5", "firestore.rules:8"]);
    const sev = Object.fromEntries(f.map((x) => [x.subject, x.severity.tier]));
    expect(sev).toEqual({ "database.rules.json:3": "HIGH", "firestore.rules:5": "MODERATE", "firestore.rules:8": "HIGH" });
  });

  it("GSK-CORS-001 flags wildcard origins, escalates with credentials, and honours suppressions", async () => {
    const { findings, summary } = await patternFindings(VIBE);
    const f = byRule(findings, "GSK-CORS-001");
    // next.config: key/value on separate lines + credentials in the same file -> HIGH.
    // app/api/public/route.ts: suppression without reason is invalid -> still reported.
    // app/api/webhook/route.ts: suppressed with a reason -> not reported.
    expect(subjects(f)).toEqual(["app/api/public/route.ts:5", "next.config.mjs:10"]);
    const withCreds = f.find((x) => x.subject === "next.config.mjs:10");
    const noCreds = f.find((x) => x.subject === "app/api/public/route.ts:5");
    expect(withCreds?.severity.tier).toBe("HIGH");
    expect(withCreds?.priority).toBe("P1");
    // Without credentials a wildcard is informational: LOW, P3, never gated by the default threshold.
    expect(noCreds?.severity.tier).toBe("LOW");
    expect(noCreds?.priority).toBe("P3");
    expect(noCreds?.evidence.kind === "insecure-pattern" ? noCreds.evidence.message : "").toMatch(/No credentials are enabled in this file/);
    expect(summary.suppressions).toEqual([{ file: "app/api/webhook/route.ts", line: 5, ruleId: "GSK-CORS-001", reason: "public webhook, no cookies involved" }]);
    expect(summary.invalidSuppressions).toEqual([{ file: "app/api/public/route.ts", line: 4, text: "// gateseeker-ignore GSK-CORS-001" }]);
  });

  it("GSK-ENV-001 flags .env not covered by .gitignore and ignores the covered .env.local", async () => {
    const { findings } = await patternFindings(VIBE);
    const f = byRule(findings, "GSK-ENV-001");
    expect(subjects(f)).toEqual([".env:2"]);
    expect(f[0]?.evidence.kind === "insecure-pattern" ? f[0].evidence.details : null).toEqual({ nonPublicVariables: 2, gitignorePresent: true });
    expect(f[0]?.severity.tier).toBe("MODERATE");
  });

  it("GSK-BUILD-001 flags ignored build errors as P3", async () => {
    const { findings } = await patternFindings(VIBE);
    const f = byRule(findings, "GSK-BUILD-001");
    expect(subjects(f)).toEqual(["next.config.mjs:3", "next.config.mjs:4"]);
    expect(f.every((x) => x.priority === "P3" && x.severity.tier === "LOW")).toBe(true);
  });

  it("never writes a full secret into the findings", async () => {
    const { findings } = await patternFindings(VIBE);
    const json = JSON.stringify(findings);
    for (const [name, value] of Object.entries(SECRETS)) {
      if (name === "anon") continue; // public by design; not a finding either way
      expect(json, `secret ${name} leaked`).not.toContain(value);
    }
    expect(json).toContain("sk_l…[32 chars]");
    expect(json).not.toContain("fixture-fallback-password-123");
  });

  it("masks long quoted literals in code snippets but keeps short ones", () => {
    expect(maskQuotedLiterals("cors({ origin: '*' })")).toBe("cors({ origin: '*' })");
    expect(maskQuotedLiterals("const p = process.env.X || 'super-secret-value';")).toBe("const p = process.env.X || '<redacted 18 chars>';");
    expect(maskQuotedLiterals('a("it\'s ok", "another long literal here")')).toBe('a("<redacted 7 chars>", "<redacted 25 chars>")'.replace("<redacted 7 chars>", "it's ok"));
    expect(maskQuotedLiterals("x = `template literal value`")).toBe("x = `<redacted 22 chars>`");
    expect(maskQuotedLiterals("unterminated 'quote")).toBe("unterminated 'quote");
  });

  it("runs every rule and records them", async () => {
    const { summary } = await patternFindings(VIBE);
    expect(summary.rulesRun).toEqual(RULES.map((r) => r.id));
    expect(summary.filesScanned).toBeGreaterThan(10);
  });
});

describe("rules on the clean-vite fixture", () => {
  it("produce no findings", async () => {
    const { findings } = await patternFindings(CLEAN);
    expect(findings.map((f) => `${f.evidence.kind === "insecure-pattern" ? f.evidence.ruleId : f.kind} ${f.subject}`)).toEqual([]);
  });
});

describe("scanDirectory", () => {
  const lodash = readFixture("osv/lodash-4.17.20.json");
  const fetchFn: typeof fetch = (_url, init) => {
    const body = JSON.parse(init?.body as string) as { package: { name: string } };
    return Promise.resolve(new Response(body.package.name === "lodash" ? lodash : "{}", { status: 200, headers: { "content-type": "application/json" } }));
  };

  it("combines dependency and pattern findings; warn mode gates on dependencies only", async () => {
    const r = await scanDirectory({ root: VIBE, osv: { fetch: fetchFn }, now: fixedNow, runId: "t" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rep = r.report;
    expect(rep.analyses).toEqual({ dependencies: "analyzed", patterns: "analyzed" });
    expect(rep.summary.byKind["dependency-vulnerability"]).toBe(5);
    expect(rep.summary.byKind["insecure-pattern"]).toBeGreaterThan(10);
    expect(rep.gate).toMatchObject({ patternsMode: "warn", verdict: "fail", reason: "5 finding(s) at priority P2 or higher." });
    expect(rep.project.lockfileVersion).toBe(3);
    expect(rep.patterns?.rulesRun.length).toBe(RULES.length);
    expect(rep.sources.map((s) => s.name)).toEqual(["osv.dev", "gateseeker-advisories", "gateseeker-rules"]);
    expect(rep.errors).toContain("Suppression without a reason ignored at app/api/public/route.ts:4.");
  });

  it("gate mode counts pattern findings in the verdict", async () => {
    const warn = await scanDirectory({ root: VIBE, only: "patterns", patternsMode: "warn", now: fixedNow });
    const gate = await scanDirectory({ root: VIBE, only: "patterns", patternsMode: "gate", now: fixedNow });
    expect(warn.ok && gate.ok).toBe(true);
    if (!warn.ok || !gate.ok) return;
    expect(warn.report.analyses.dependencies).toBe("not-analyzed");
    expect(warn.report.gate.verdict).toBe("pass");
    expect(warn.report.gate.reason).toMatch(/warn mode \(not gated\)/);
    expect(gate.report.gate.verdict).toBe("fail");
    expect(gate.report.summary.byPriority.P1).toBeGreaterThan(0);
  });

  it("without a lockfile, dependencies are declared not analyzed and the verdict is not incomplete", async () => {
    const r = await scanDirectory({ root: CLEAN, now: fixedNow });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.analyses).toEqual({ dependencies: "not-analyzed", patterns: "analyzed" });
    expect(r.report.project.lockfilePath).toBeNull();
    expect(r.report.gate.verdict).toBe("pass");
    expect(r.report.findings).toEqual([]);
    expect(r.report.limitations.join("\n")).toMatch(/Dependencies were not analyzed/);
  });

  it("--only deps skips patterns", async () => {
    const r = await scanDirectory({ root: VIBE, only: "deps", osv: { fetch: fetchFn }, now: fixedNow });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.analyses).toEqual({ dependencies: "analyzed", patterns: "not-analyzed" });
    expect(r.report.patterns).toBeNull();
    expect(r.report.summary.byKind["insecure-pattern"]).toBe(0);
  });

  it("propagates walker limit errors", async () => {
    const r = await scanDirectory({ root: VIBE, only: "patterns", walkLimits: { maxFiles: 2 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too-many-files");
  });
});

describe("regex safety (ReDoS budget)", () => {
  const adversarial = [
    "sk-".repeat(350_000),
    "AKIA".repeat(260_000),
    "e".repeat(1_000_000),
    "eyJ".repeat(340_000),
    `${"a".repeat(500_000)}.${"b".repeat(500_000)}`,
    "-----BEGIN ".repeat(90_000),
    "xoxb-".repeat(200_000),
    "github_pat_".repeat(90_000),
    "_".repeat(1_000_000),
  ];
  for (const p of SECRET_PATTERNS) {
    it(`${p.name} stays under budget on 1 MB adversarial input`, () => {
      for (const input of adversarial) {
        const start = performance.now();
        p.regex.lastIndex = 0;
        const count = [...input.matchAll(p.regex)].length;
        expect(performance.now() - start).toBeLessThan(200);
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

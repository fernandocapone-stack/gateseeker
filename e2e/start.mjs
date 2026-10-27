/* global process */
// Prepares a throwaway git repository with two proposed records, then starts
// the triage server against it. Used as Playwright's webServer command so the
// repository exists before the server (Playwright starts the server first).
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(".e2e-tmp", "repo");
rmSync(resolve(".e2e-tmp"), { recursive: true, force: true });
mkdirSync(join(root, "advisories", "proposed"), { recursive: true });
mkdirSync(join(root, "advisories", "approved"), { recursive: true });
mkdirSync(join(root, "advisories", "rejected"), { recursive: true });
cpSync(resolve("fixtures", "intel", "advisories", "proposed-npm-synthetic.json"), join(root, "advisories", "proposed", "one.json"));

const second = {
  id: "GSK-ADV-2026-9003",
  status: "proposed",
  type: "other",
  severity: "HIGH",
  ecosystem: "other",
  packages: [{ name: "UNKNOWN/fill-in", affected: {} }],
  window: { start: null, end: null },
  indicators: [],
  summary: "TODO: one line written by the reviewer after reading the source.",
  remediation: "TODO: concrete action written by the reviewer.",
  sources: [{ url: "https://example.com/e2e-report", publisher: "Example Publisher A", title: "E2E report about a fictitious CLI release swap", published_at: "2026-10-20" }],
  review: { proposed_by: "collector", proposed_at: "2026-10-20T06:00:00Z", reviewed_by: null, reviewed_at: null, notes: null },
  upstream: { osv: null, ghsa: null },
  draft: { type: "tag-rewrite", severity: "CRITICAL", summary: "Draft: release binaries of a fictitious CLI were swapped for two hours." },
};
writeFileSync(join(root, "advisories", "proposed", "two.json"), `${JSON.stringify(second, null, 2)}\n`);

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("config", "user.name", "E2E Reviewer");
git("config", "user.email", "e2e@example.invalid");
git("add", "-A");
git("commit", "-q", "-m", "seed");

const child = spawn(process.execPath, ["dist/intel-cli.js", "ui", "--root", root, "--ui-dist", resolve("ui", "dist"), "--port", "4311", "--no-open", "--no-merge-intel", "--token", "e2e-token"], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill());

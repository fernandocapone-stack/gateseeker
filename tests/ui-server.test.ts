import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Advisory } from "../src/intel/advisory-schema.js";
import { assertAllowed, type GitResult, type GitRunner } from "../src/intel/ui/git.js";
import { createUiServer, type UiServer } from "../src/intel/ui/server.js";
import type { DecideResponse, UiState } from "../src/intel/ui/types.js";
import { readJsonFixture } from "./helpers.js";

const PROPOSED = readJsonFixture("intel/advisories/proposed-npm-synthetic.json") as Advisory;
const APPROVED_FIXTURE = readJsonFixture("intel/advisories/approved-npm-synthetic.json") as Advisory;

/** Fake git: records calls, answers config/rev-parse/rev-list, succeeds on add/commit/push. */
function fakeGit(overrides: Partial<Record<string, GitResult>> = {}) {
  const calls: string[][] = [];
  let commits = 0;
  const run: GitRunner = (args) => {
    calls.push(args);
    assertAllowed(args);
    const sub = args[0] ?? "";
    const o = overrides[sub];
    if (o) return Promise.resolve(o);
    switch (sub) {
      case "config":
        return Promise.resolve({ code: 0, stdout: "Test Reviewer\n", stderr: "" });
      case "rev-parse":
        return Promise.resolve({ code: 0, stdout: args.includes("--short") ? `c0ffee${commits}\n` : "main\n", stderr: "" });
      case "rev-list":
        return Promise.resolve({ code: 0, stdout: `${commits}\n`, stderr: "" });
      case "commit":
        commits++;
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
      default:
        return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    }
  };
  return { run, calls };
}

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gateseeker-ui-"));
  await mkdir(join(dir, "advisories", "proposed"), { recursive: true });
  await mkdir(join(dir, "advisories", "approved"), { recursive: true });
  await mkdir(join(dir, "advisories", "rejected"), { recursive: true });
  await mkdir(join(dir, "ui", "dist"), { recursive: true });
  await writeFile(join(dir, "ui", "dist", "index.html"), "<!doctype html><title>t</title>ok");
  await writeFile(join(dir, "advisories", "proposed", "p.json"), JSON.stringify(PROPOSED));
  await writeFile(join(dir, "advisories", "proposed", "q.json"), JSON.stringify({ ...PROPOSED, id: "GSK-ADV-2026-9003", draft: { severity: "LOW", summary: "draft summary" } }));
  return dir;
}

async function start(root: string, git: GitRunner): Promise<{ ui: UiServer; base: string; stop: () => Promise<void> }> {
  const ui = createUiServer({ root, git, token: "test-token", now: () => new Date("2026-10-27T12:00:00.000Z") });
  await new Promise<void>((r) => ui.server.listen(0, "127.0.0.1", r));
  const port = (ui.server.address() as AddressInfo).port;
  return { ui, base: `http://127.0.0.1:${port}`, stop: () =>
      new Promise((r) => {
        ui.server.close(() => {
          r();
        });
      }) };
}

const auth = { "x-gateseeker-token": "test-token", "content-type": "application/json" };

describe("git allowlist", () => {
  it("accepts additive commands and refuses the rest", () => {
    expect(() => {
      assertAllowed(["add", "-A", "advisories"]);
    }).not.toThrow();
    expect(() => {
      assertAllowed(["commit", "-q", "-m", "x"]);
    }).not.toThrow();
    expect(() => {
      assertAllowed(["merge", "--no-edit", "origin/intel/x"]);
    }).not.toThrow();
    expect(() => {
      assertAllowed(["push"]);
    }).not.toThrow();
    expect(() => {
      assertAllowed(["reset", "--hard"]);
    }).toThrow(/not allowed/);
    expect(() => {
      assertAllowed(["push", "--force"]);
    }).toThrow(/not allowed/);
    expect(() => {
      assertAllowed(["branch", "-D", "main"]);
    }).toThrow(/not allowed/);
    expect(() => {
      assertAllowed(["commit", "--amend"]);
    }).toThrow(/not allowed/);
    expect(() => {
      assertAllowed(["merge", "origin/x"]);
    }).toThrow(/non-interactive/);
    expect(() => {
      assertAllowed(["config", "user.email", "x"]);
    }).toThrow(/read-only/);
    expect(() => {
      assertAllowed(["checkout", "main"]);
    }).toThrow(/not allowed/);
    expect(() => {
      assertAllowed([]);
    }).toThrow(/not allowed/);
  });
});

describe("triage server", () => {
  let cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const c of cleanup) await c();
    cleanup = [];
  });

  it("requires the session token on the API and serves the UI without it", async () => {
    const root = await tempRepo();
    const { base, stop } = await start(root, fakeGit().run);
    cleanup.push(stop, () => rm(root, { recursive: true, force: true }));

    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    expect((await fetch(`${base}/api/state`, { headers: { "x-gateseeker-token": "wrong" } })).status).toBe(401);
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("ok");
    const csp = (await fetch(`${base}/api/state`, { headers: auth })).headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
  });

  it("lists pending/approved/rejected records with git context", async () => {
    const root = await tempRepo();
    await writeFile(join(root, "advisories", "approved", "a.json"), JSON.stringify(APPROVED_FIXTURE));
    const { base, stop } = await start(root, fakeGit().run);
    cleanup.push(stop, () => rm(root, { recursive: true, force: true }));

    const state = (await (await fetch(`${base}/api/state`, { headers: auth })).json()) as UiState;
    expect(state.gitUser).toBe("Test Reviewer");
    expect(state.branch).toBe("main");
    expect(state.pending.map((r) => r.id)).toEqual(["GSK-ADV-2026-9002", "GSK-ADV-2026-9003"]);
    expect(state.approved.map((r) => r.id)).toEqual(["GSK-ADV-2026-9001"]);
    expect(state.rejected).toEqual([]);
    expect(state.pending[1]?.data.draft).toEqual({ severity: "LOW", summary: "draft summary" });
  });

  it("rejects with a reason: moves the file, stamps the reviewer, commits", async () => {
    const root = await tempRepo();
    const git = fakeGit();
    const { base, stop } = await start(root, git.run);
    cleanup.push(stop, () => rm(root, { recursive: true, force: true }));

    const res = await fetch(`${base}/api/decide`, { method: "POST", headers: auth, body: JSON.stringify({ id: "GSK-ADV-2026-9002", action: "reject", record: PROPOSED, reason: "covered by OSV MAL-2026-0001" }) });
    const body = (await res.json()) as DecideResponse;
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, dir: "rejected", file: "p.json", commit: "c0ffee1" });

    expect(await readdir(join(root, "advisories", "proposed"))).toEqual(["q.json"]);
    const saved = JSON.parse(await readFile(join(root, "advisories", "rejected", "p.json"), "utf8")) as Advisory;
    expect(saved.status).toBe("rejected");
    expect(saved.review.reviewed_by).toBe("Test Reviewer");
    expect(saved.review.reviewed_at).toBe("2026-10-27T12:00:00.000Z");
    expect(saved.review.notes).toBe("Rejected 2026-10-27: covered by OSV MAL-2026-0001");
    expect(git.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["add", "commit"]));
    const commit = git.calls.find((c) => c[0] === "commit");
    expect(commit?.join(" ")).toContain("intel: reject GSK-ADV-2026-9002");
  });

  it("refuses to reject without a reason and to approve without enough sources", async () => {
    const root = await tempRepo();
    const { base, stop } = await start(root, fakeGit().run);
    cleanup.push(stop, () => rm(root, { recursive: true, force: true }));

    const noReason = await fetch(`${base}/api/decide`, { method: "POST", headers: auth, body: JSON.stringify({ id: "GSK-ADV-2026-9002", action: "reject", record: PROPOSED }) });
    expect(noReason.status).toBe(422);
    expect(((await noReason.json()) as DecideResponse)).toEqual({ ok: false, issues: ["a reason is required to reject"] });

    const oneSource = await fetch(`${base}/api/decide`, { method: "POST", headers: auth, body: JSON.stringify({ id: "GSK-ADV-2026-9002", action: "approve", record: PROPOSED }) });
    expect(oneSource.status).toBe(422);
    const issues = ((await oneSource.json()) as DecideResponse & { ok: false }).issues.join("\n");
    expect(issues).toMatch(/two sources from distinct publishers/);
    // Nothing moved.
    expect((await readdir(join(root, "advisories", "proposed"))).sort()).toEqual(["p.json", "q.json"]);
  });

  it("approves a completed record, strips the draft block and commits", async () => {
    const root = await tempRepo();
    const git = fakeGit();
    const { base, stop } = await start(root, git.run);
    cleanup.push(stop, () => rm(root, { recursive: true, force: true }));

    const completed: Advisory = {
      ...PROPOSED,
      id: "GSK-ADV-2026-9003",
      severity: "LOW",
      summary: "Confirmed by the reviewer.",
      remediation: "Upgrade.",
      sources: [...PROPOSED.sources, { url: "https://example.org/second", publisher: "Example Publisher B", title: "Second", published_at: "2026-02-02" }],
      draft: { severity: "LOW" },
    };
    const res = await fetch(`${base}/api/decide`, { method: "POST", headers: auth, body: JSON.stringify({ id: "GSK-ADV-2026-9003", action: "approve", record: completed }) });
    expect(res.status).toBe(200);
    const saved = JSON.parse(await readFile(join(root, "advisories", "approved", "q.json"), "utf8")) as Advisory;
    expect(saved.status).toBe("approved");
    expect(saved.draft).toBeUndefined();
    expect(saved.review.reviewed_by).toBe("Test Reviewer");
    expect(saved.id).toBe("GSK-ADV-2026-9003"); // the id cannot be changed by the client
  });

  it("save keeps the record pending without a commit; unknown ids are refused", async () => {
    const root = await tempRepo();
    const git = fakeGit();
    const { base, stop } = await start(root, git.run);
    cleanup.push(stop, () => rm(root, { recursive: true, force: true }));

    const res = await fetch(`${base}/api/decide`, { method: "POST", headers: auth, body: JSON.stringify({ id: "GSK-ADV-2026-9002", action: "save", record: { ...PROPOSED, summary: "work in progress" } }) });
    expect(((await res.json()) as DecideResponse)).toEqual({ ok: true, dir: "proposed", file: "p.json", commit: null });
    expect(git.calls.some((c) => c[0] === "commit")).toBe(false);
    const saved = JSON.parse(await readFile(join(root, "advisories", "proposed", "p.json"), "utf8")) as Advisory;
    expect(saved.summary).toBe("work in progress");

    const unknown = await fetch(`${base}/api/decide`, { method: "POST", headers: auth, body: JSON.stringify({ id: "GSK-ADV-2026-0000", action: "save", record: PROPOSED }) });
    expect(unknown.status).toBe(422);
  });

  it("refuses to approve when git has no user.name", async () => {
    const root = await tempRepo();
    const git = fakeGit({ config: { code: 1, stdout: "", stderr: "" } });
    const { base, stop } = await start(root, git.run);
    cleanup.push(stop, () => rm(root, { recursive: true, force: true }));
    const res = await fetch(`${base}/api/decide`, { method: "POST", headers: auth, body: JSON.stringify({ id: "GSK-ADV-2026-9002", action: "reject", record: PROPOSED, reason: "x" }) });
    expect(res.status).toBe(422);
    expect(((await res.json()) as DecideResponse & { ok: false }).issues[0]).toMatch(/user.name is not configured/);
  });

  it("push reports git's outcome", async () => {
    const root = await tempRepo();
    const git = fakeGit({ push: { code: 1, stdout: "", stderr: "rejected: fetch first" } });
    const { base, stop } = await start(root, git.run);
    cleanup.push(stop, () => rm(root, { recursive: true, force: true }));
    const res = await fetch(`${base}/api/push`, { method: "POST", headers: auth, body: "{}" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "rejected: fetch first" });
  });

  it("does not serve files outside the UI directory", async () => {
    const root = await tempRepo();
    await writeFile(join(root, "secret.txt"), "nope");
    const { base, stop } = await start(root, fakeGit().run);
    cleanup.push(stop, () => rm(root, { recursive: true, force: true }));
    const res = await fetch(`${base}/..%2Fsecret.txt`);
    expect(await res.text()).not.toContain("nope");
  });
});

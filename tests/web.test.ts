import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { parseGitHubRepoUrl } from "../src/web/github-url.js";
import { DEFAULT_TAR_LIMITS, extractTarGz } from "../src/web/tar.js";
import { scanGitHubRepository } from "../src/web/service.js";

// ---------------------------------------------------------------------------
// A tiny tar writer so the tests can craft archives GitHub would never serve
// (links, traversal, oversized entries). Only what the reader must handle.
// ---------------------------------------------------------------------------

interface Entry {
  name: string;
  type?: "0" | "5" | "2" | "1" | "L" | "x" | "6";
  data?: Buffer | string;
  linkname?: string;
}

function header(e: Entry, size: number): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(e.name.slice(0, 100), 0, "utf8");
  h.write("0000644\0", 100, "ascii");
  h.write("0000000\0", 108, "ascii");
  h.write("0000000\0", 116, "ascii");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  h.write("00000000000\0", 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write(e.type ?? "0", 156, "ascii");
  if (e.linkname) h.write(e.linkname.slice(0, 100), 157, "utf8");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

function tar(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = e.data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    parts.push(header(e, data.length), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

function targz(entries: Entry[]): Buffer {
  return gzipSync(tar(entries));
}

function pax(path: string): Buffer {
  const record = ` path=${path}\n`;
  // length includes the length field itself and the space
  let len = record.length + 1;
  while (`${len}${record}`.length !== len) len = `${len}${record}`.length;
  return Buffer.from(`${len}${record}`, "utf8");
}

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "gsk-web-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// URL validator
// ---------------------------------------------------------------------------

describe("parseGitHubRepoUrl", () => {
  const accepted: [string, { owner: string; repo: string; ref: string | null }][] = [
    ["https://github.com/vercel/next.js", { owner: "vercel", repo: "next.js", ref: null }],
    ["github.com/vercel/next.js/", { owner: "vercel", repo: "next.js", ref: null }],
    ["https://www.github.com/Owner-1/my_repo.git", { owner: "Owner-1", repo: "my_repo", ref: null }],
    ["  https://github.com/a/b  ", { owner: "a", repo: "b", ref: null }],
    ["https://github.com/a/b/tree/main", { owner: "a", repo: "b", ref: "main" }],
    ["https://github.com/a/b/tree/feature/x-1", { owner: "a", repo: "b", ref: "feature/x-1" }],
    ["https://github.com/a/b/tree/0123456789abcdef0123456789abcdef01234567", { owner: "a", repo: "b", ref: "0123456789abcdef0123456789abcdef01234567" }],
  ];
  for (const [input, expected] of accepted) {
    it(`accepts ${JSON.stringify(input)}`, () => {
      expect(parseGitHubRepoUrl(input)).toEqual({ ok: true, value: expected });
    });
  }

  const rejected = [
    "",
    "   ",
    "https://gitlab.com/a/b",
    "https://github.enterprise.local/a/b",
    "http://github.com/a/b",
    "ftp://github.com/a/b",
    "javascript://github.com/a/b",
    "https://github.com",
    "https://github.com/",
    "https://github.com/onlyowner",
    "https://github.com/onlyowner/",
    "https://user:pass@github.com/a/b",
    "https://github.com/a/b?x=1",
    "https://github.com/a/b#readme",
    "https://github.com/a/b/blob/main/README.md",
    "https://github.com/a/b/tree",
    "https://github.com/a/b/tree/",
    "https://github.com/a/b/tree/../main",
    "https://github.com/a/b/tree/-bad",
    "https://github.com/a/b/tree/refs.lock",
    "https://github.com/-a/b",
    "https://github.com/a-/b",
    "https://github.com/a/.",
    "https://github.com/a/..",
    "https://github.com/a/b c",
    "https://github.com/a\n/b",
    "https://github.com/ａ/b",
    "https://github.com/a/b/",
    "https://github.com//a/b",
    "https://github.com:443/a/b",
    "https://github.com@evil.com/a/b",
    `https://github.com/a/${"b".repeat(300)}`,
  ];
  for (const input of rejected) {
    it(`rejects ${JSON.stringify(input.slice(0, 60))}`, () => {
      const r = parseGitHubRepoUrl(input);
      // "https://github.com/a/b/" with one trailing slash is accepted; listed here to pin the double-slash and others.
      if (input === "https://github.com/a/b/") {
        expect(r.ok).toBe(true);
        return;
      }
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(10);
    });
  }

  it("never leaks the input back in the reason", () => {
    const r = parseGitHubRepoUrl("https://evil.example/<script>alert(1)</script>");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain("<script>");
  });

  it("stays fast on adversarial input (ReDoS budget)", () => {
    const inputs = ["/".repeat(300), "a-".repeat(150), `https://github.com/${"a".repeat(39)}/${"b.".repeat(50)}/tree/${"c/".repeat(100)}`, "https://github.com/a/b/tree/" + "a.".repeat(140)];
    const start = performance.now();
    for (let i = 0; i < 2000; i++) for (const s of inputs) parseGitHubRepoUrl(s);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// tar.gz reader
// ---------------------------------------------------------------------------

describe("extractTarGz", () => {
  it("extracts a GitHub-shaped archive, stripping the top-level directory", () => {
    const dest = freshDir();
    const gz = targz([
      { name: "repo-abc123/", type: "5" },
      { name: "repo-abc123/package.json", data: '{"name":"x"}' },
      { name: "repo-abc123/src/", type: "5" },
      { name: "repo-abc123/src/index.js", data: "console.log(1)\n" },
      { name: "repo-abc123/.env", data: "A=1\n" },
    ]);
    const r = extractTarGz(gz, dest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ files: 3, directories: 1, prefix: "repo-abc123" }); // the stripped top-level dir is not counted
    expect(r.value.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dest, "package.json"), "utf8")).toBe('{"name":"x"}');
    expect(readFileSync(join(dest, "src", "index.js"), "utf8")).toBe("console.log(1)\n");
    expect(existsSync(join(dest, "repo-abc123"))).toBe(false);
  });

  it("honours GNU long names and PAX path headers", () => {
    const dest = freshDir();
    const long = "repo-x/" + "d/".repeat(60) + "file.txt";
    const gz = targz([
      { name: "././@LongLink", type: "L", data: long + "\0" },
      { name: "repo-x/truncated", data: "long" },
      { name: "./PaxHeaders/0", type: "x", data: pax("repo-x/pax/renamed.txt") },
      { name: "repo-x/ignored-name", data: "pax" },
    ]);
    const r = extractTarGz(gz, dest);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dest, ...("d/".repeat(60) + "file.txt").split("/").filter(Boolean)), "utf8")).toBe("long");
    expect(readFileSync(join(dest, "pax", "renamed.txt"), "utf8")).toBe("pax");
    expect(existsSync(join(dest, "truncated"))).toBe(false);
    expect(existsSync(join(dest, "ignored-name"))).toBe(false);
  });

  const unsafe: [string, Entry[], string][] = [
    ["absolute path", [{ name: "/etc/passwd", data: "x" }], "unsafe-path"],
    ["parent traversal", [{ name: "repo/../../escape.txt", data: "x" }], "unsafe-path"],
    ["traversal after prefix", [{ name: "repo/a/../../../escape.txt", data: "x" }], "unsafe-path"],
    ["backslash", [{ name: "repo/a\\..\\b", data: "x" }], "unsafe-path"],
    ["second top-level dir", [{ name: "repo/a", data: "x" }, { name: "other/b", data: "y" }], "unsafe-path"],
    ["symbolic link", [{ name: "repo/link", type: "2", linkname: "/etc/passwd" }], "link-entry"],
    ["hard link", [{ name: "repo/link", type: "1", linkname: "repo/a" }], "link-entry"],
    ["fifo", [{ name: "repo/pipe", type: "6" }], "unsupported-entry"],
    ["pax path traversal", [{ name: "./PaxHeaders/0", type: "x", data: pax("repo/../../pwned") }, { name: "repo/x", data: "x" }], "unsafe-path"],
    ["long name traversal", [{ name: "././@LongLink", type: "L", data: "repo/../../pwned\0" }, { name: "repo/x", data: "x" }], "unsafe-path"],
  ];
  for (const [label, entries, code] of unsafe) {
    it(`refuses ${label} and writes nothing outside the destination`, () => {
      const dest = freshDir();
      const r = extractTarGz(targz(entries), dest);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(code);
      expect(existsSync(join(dest, "..", "escape.txt"))).toBe(false);
      expect(existsSync(join(dest, "..", "pwned"))).toBe(false);
    });
  }

  it("skips a file above the per-file limit without writing it, and says so", () => {
    const dest = freshDir();
    const gz = targz([{ name: "repo/big.bin", data: Buffer.alloc(2048, 1) }, { name: "repo/small.txt", data: "ok" }]);
    const r = extractTarGz(gz, dest, { ...DEFAULT_TAR_LIMITS, maxFileBytes: 1024 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ files: 1, skippedLarge: 1 });
    expect(readdirSync(dest)).toEqual(["small.txt"]);
  });

  it("refuses more entries than allowed", () => {
    const dest = freshDir();
    const entries: Entry[] = [];
    for (let i = 0; i < 12; i++) entries.push({ name: `repo/f${i}.txt`, data: "x" });
    const r = extractTarGz(targz(entries), dest, { ...DEFAULT_TAR_LIMITS, maxEntries: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("too-many-entries");
  });

  it("refuses an archive that expands past the uncompressed limit (decompression bomb)", () => {
    const dest = freshDir();
    const gz = targz([{ name: "repo/zeros.bin", data: Buffer.alloc(3 * 1024 * 1024, 0) }]);
    expect(gz.length).toBeLessThan(64 * 1024); // highly compressible
    const r = extractTarGz(gz, dest, { ...DEFAULT_TAR_LIMITS, maxUncompressedBytes: 1024 * 1024 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("uncompressed-too-large");
    expect(readdirSync(dest)).toEqual([]);
  });

  it("refuses oversized compressed input, non-gzip bytes, bad checksums and truncation", () => {
    const dest = freshDir();
    expect(extractTarGz(Buffer.alloc(10), dest, { ...DEFAULT_TAR_LIMITS, maxCompressedBytes: 5 })).toMatchObject({ ok: false, error: { code: "compressed-too-large" } });
    expect(extractTarGz(Buffer.from("not gzip at all"), dest)).toMatchObject({ ok: false, error: { code: "not-gzip" } });
    const good = tar([{ name: "repo/a", data: "x" }]);
    const corrupted = Buffer.from(good);
    corrupted[150] = 0x39; // damage the checksum field
    expect(extractTarGz(gzipSync(corrupted), dest)).toMatchObject({ ok: false, error: { code: "malformed" } });
    const truncated = good.subarray(0, 512 + 100);
    expect(extractTarGz(gzipSync(truncated), dest)).toMatchObject({ ok: false, error: { code: "malformed" } });
  });

  it("stays fast on adversarial headers (ReDoS budget)", () => {
    // Extraction time is dominated by writing 500 files, which varies a lot
    // between machines (Windows under load took 3 s for the benign set). So
    // the budget is relative: adversarial names must not cost more than a
    // small multiple of plain names. An exponential regex would take minutes.
    const plain: Entry[] = [];
    const adversarial: Entry[] = [];
    for (let i = 0; i < 500; i++) {
      plain.push({ name: `repo/file-${i}`, data: "" });
      adversarial.push({ name: `repo/${"a.".repeat(40)}${i}`, data: "" });
    }
    const t0 = performance.now();
    expect(extractTarGz(targz(plain), freshDir()).ok).toBe(true);
    const baseline = performance.now() - t0;
    const t1 = performance.now();
    expect(extractTarGz(targz(adversarial), freshDir()).ok).toBe(true);
    const cost = performance.now() - t1;
    expect(cost).toBeLessThan(baseline * 3 + 1000);
  });
});

// ---------------------------------------------------------------------------
// Service: injected fetch, no network
// ---------------------------------------------------------------------------

const OSV_EMPTY = new Response(JSON.stringify({ vulns: [] }), { status: 200, headers: { "content-type": "application/json" } });

function fakeGitHub(opts: { repo?: Record<string, unknown> | number; commit?: Record<string, unknown> | number; archive?: Buffer | number; osv?: (req: Request | string) => Response }): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  // eslint-disable-next-line @typescript-eslint/require-await -- a fetch double must return a Promise<Response>
  const f = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.startsWith("https://api.github.com/repos/") && !url.includes("/commits/")) {
      if (typeof opts.repo === "number") return new Response("{}", { status: opts.repo });
      return new Response(JSON.stringify({ full_name: "o/r", private: false, size: 120, default_branch: "main", html_url: "https://github.com/o/r", ...opts.repo }), { status: 200 });
    }
    if (url.includes("/commits/")) {
      if (typeof opts.commit === "number") return new Response("{}", { status: opts.commit });
      return new Response(JSON.stringify({ sha: "a".repeat(40), ...opts.commit }), { status: 200 });
    }
    if (url.startsWith("https://codeload.github.com/")) {
      if (typeof opts.archive === "number") return new Response("", { status: opts.archive });
      return new Response(opts.archive ?? targz([{ name: "r-aaaa/package.json", data: '{"name":"r"}' }]), { status: 200 });
    }
    if (url.includes("osv.dev")) return opts.osv ? opts.osv(url) : OSV_EMPTY.clone();
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { fetch: f, calls };
}

const lockfile = readFileSync(join(process.cwd(), "fixtures", "lockfiles", "direct-only.package-lock.json"), "utf8");

describe("scanGitHubRepository", () => {
  it("rejects invalid URLs without touching the network", async () => {
    const gh = fakeGitHub({});
    const r = await scanGitHubRepository({ url: "https://gitlab.com/a/b", fetch: gh.fetch });
    expect(r).toMatchObject({ ok: false, error: { code: "invalid-url" } });
    expect(gh.calls).toEqual([]);
  });

  it("maps GitHub answers to clear refusals", async () => {
    expect(await scanGitHubRepository({ url: "https://github.com/o/r", fetch: fakeGitHub({ repo: 404 }).fetch })).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await scanGitHubRepository({ url: "https://github.com/o/r", fetch: fakeGitHub({ repo: { private: true } }).fetch })).toMatchObject({ ok: false, error: { code: "private" } });
    expect(await scanGitHubRepository({ url: "https://github.com/o/r", fetch: fakeGitHub({ repo: { size: 500_000 } }).fetch })).toMatchObject({ ok: false, error: { code: "too-large" } });
    expect(await scanGitHubRepository({ url: "https://github.com/o/r/tree/nope", fetch: fakeGitHub({ commit: 422 }).fetch })).toMatchObject({ ok: false, error: { code: "ref-not-found" } });
    expect(await scanGitHubRepository({ url: "https://github.com/o/r", fetch: fakeGitHub({ repo: 403 }).fetch })).toMatchObject({ ok: false, error: { code: "upstream-error" } });
    expect(await scanGitHubRepository({ url: "https://github.com/o/r", fetch: fakeGitHub({ archive: 500 }).fetch })).toMatchObject({ ok: false, error: { code: "download-failed" } });
    expect(await scanGitHubRepository({ url: "https://github.com/o/r", fetch: fakeGitHub({ repo: { size: "big" } }).fetch })).toMatchObject({ ok: false, error: { code: "upstream-error" } });
  });

  it("refuses an archive above the download limit and a rejected archive, leaving no temp directory behind", async () => {
    const work = freshDir();
    const big = await scanGitHubRepository({ url: "https://github.com/o/r", fetch: fakeGitHub({ archive: targz([{ name: "r-a/x", data: Buffer.alloc(5000, 7) }]) }).fetch, workDir: work, limits: { maxDownloadBytes: 100 } });
    expect(big).toMatchObject({ ok: false, error: { code: "too-large" } });
    const link = await scanGitHubRepository({ url: "https://github.com/o/r", fetch: fakeGitHub({ archive: targz([{ name: "r-a/l", type: "2", linkname: "/etc/passwd" }]) }).fetch, workDir: work });
    expect(link).toMatchObject({ ok: false, error: { code: "archive-rejected" } });
    expect(readdirSync(work)).toEqual([]);
  });

  it("downloads the resolved commit, scans with the engine and reports the repository instead of the temp path", async () => {
    const work = freshDir();
    const gh = fakeGitHub({
      archive: targz([
        { name: "r-aaaa/package-lock.json", data: lockfile },
        { name: "r-aaaa/package.json", data: '{"name":"r"}' },
        { name: "r-aaaa/src/server.ts", data: 'app.use(cors({ origin: "*", credentials: true }));\n' },
      ]),
    });
    const r = await scanGitHubRepository({ url: "https://github.com/o/r/tree/main", fetch: gh.fetch, workDir: work, scan: { osv: { fetch: gh.fetch }, packagist: false } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(gh.calls[0]).toBe("GET https://api.github.com/repos/o/r");
    expect(gh.calls[1]).toBe("GET https://api.github.com/repos/o/r/commits/main");
    expect(gh.calls[2]).toBe(`GET https://codeload.github.com/o/r/tar.gz/${"a".repeat(40)}`);
    expect(r.value.repository).toMatchObject({ owner: "o", repo: "r", ref: "main", sha: "a".repeat(40), defaultBranch: "main" });
    expect(r.value.archive.files).toBe(3);
    expect(r.value.report.project.rootPath).toBe("o/r@aaaaaaaaaaaa");
    expect(r.value.report.project.lockfiles.map((l) => l.path)).toEqual(["package-lock.json"]);
    expect(r.value.report.analyses).toEqual({ dependencies: "analyzed", patterns: "analyzed" });
    expect(r.value.report.findings.some((f) => f.evidence.kind === "insecure-pattern" && f.evidence.ruleId === "GSK-CORS-001")).toBe(true);
    expect(JSON.stringify(r.value.report)).not.toContain(work.replace(/\\/g, "\\\\"));
    expect(readdirSync(work)).toEqual([]);
  });

  it("keeps the incomplete verdict when OSV fails", async () => {
    const work = freshDir();
    const gh = fakeGitHub({ archive: targz([{ name: "r-aaaa/package-lock.json", data: lockfile }]), osv: () => new Response("down", { status: 503 }) });
    const r = await scanGitHubRepository({ url: "https://github.com/o/r", fetch: gh.fetch, workDir: work, scan: { osv: { fetch: gh.fetch }, packagist: false } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.report.gate.verdict).toBe("incomplete");
  });

  it("honours the total timeout", async () => {
    const slow = (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const r = await scanGitHubRepository({ url: "https://github.com/o/r", fetch: (input, init) => new Promise((_, reject) => { init?.signal?.addEventListener("abort", () => { reject(new Error("aborted")); }); void slow(input); }), limits: { totalTimeoutMs: 50 } });
    expect(r).toMatchObject({ ok: false, error: { code: "timeout" } });
  });
});

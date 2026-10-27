import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main as intelMain } from "../src/intel-cli.js";
import { validateAdvisory, type Advisory } from "../src/intel/advisory-schema.js";
import { advisoryMatches, buildAdvisoryFinding, loadAdvisories, parseAdvisoryJson } from "../src/intel/advisories.js";
import { canonicalUrl, collect, extractCandidates, isRelevant, runCollect, sourcesSchema, titleHash, type CollectorState } from "../src/intel/feed/collect.js";
import { decodeEntities, parseFeed, stripTags } from "../src/intel/feed/rss.js";
import { scan } from "../src/scan.js";
import type { Dependency } from "../src/types.js";
import { fixturePath, readFixture, readJsonFixture } from "./helpers.js";

const APPROVED = readJsonFixture("intel/advisories/approved-npm-synthetic.json") as Advisory;
const PROPOSED = readJsonFixture("intel/advisories/proposed-npm-synthetic.json") as Advisory;
const fixedNow = () => new Date("2026-10-27T12:00:00.000Z");

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe("advisory schema", () => {
  it("accepts the synthetic approved and proposed records and the inaugural Laravel-Lang proposal", async () => {
    expect(validateAdvisory(APPROVED).ok).toBe(true);
    expect(validateAdvisory(PROPOSED).ok).toBe(true);
    const laravel = JSON.parse(await readFile(join(fixturePath(".."), "advisories", "proposed", "2026-05-22-laravel-lang-tag-rewrite.json"), "utf8")) as unknown;
    const v = validateAdvisory(laravel);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    if (v.ok) {
      expect(v.advisory.status).toBe("proposed");
      expect(v.advisory.packages.map((p) => p.name)).toEqual(["laravel-lang/lang", "laravel-lang/attributes", "laravel-lang/http-statuses", "laravel-lang/actions"]);
    }
  });

  it.each([
    ["approved without reviewer", (a: Advisory) => { a.review.reviewed_by = null; }, /requires reviewed_by/],
    ["approved with a single publisher", (a: Advisory) => { a.sources = [a.sources[0]!]; }, /two sources from distinct publishers/],
    ["summary over 300 chars", (a: Advisory) => { a.summary = "x".repeat(301); }, /summary/],
    ["http source", (a: Advisory) => { a.sources[0]!.url = "http://example.com/a"; }, /https/],
    ["credential-looking token in notes", (a: Advisory) => { a.review.notes = "token sk_live_" + "Qm7Vx2Lp9Rt4Zy1Wk8Jn3Hs6Fd0Gb5Cv"; }, /looks like a stripe-live-secret-key/],
    ["non-semver npm version", (a: Advisory) => { a.packages[0]!.affected.versions = ["1.x"]; }, /not strict semver/],
    ["approved npm package without versions or ranges", (a: Advisory) => { a.packages[0]!.affected = {}; }, /need versions or ranges/],
    ["bad id", (a: Advisory) => { (a as { id: string }).id = "ADV-1"; }, /GSK-ADV-YYYY-NNNN/],
    ["unknown field", (a: Advisory) => { (a as unknown as Record<string, unknown>)["extra"] = 1; }, /Unrecognized key|unrecognized/i],
  ])("rejects %s", (_name, mutate, pattern) => {
    const a = clone(APPROVED);
    mutate(a);
    const v = validateAdvisory(a);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join("\n")).toMatch(pattern);
  });

  it("allows a single primary source for approved records", () => {
    const a = clone(APPROVED);
    a.sources = [{ ...a.sources[0]!, primary: true }];
    expect(validateAdvisory(a).ok).toBe(true);
  });
});

describe("advisory loading and matching", () => {
  const dep = (name: string, version: string, direct = true): Dependency => ({
    name,
    version,
    ecosystem: "npm",
    versionStatus: "ok",
    exposure: { direct, production: true },
    paths: [`node_modules/${name}`],
  });

  it("matches exact versions and ranges, not fixed or unrelated versions", () => {
    expect(advisoryMatches(APPROVED, dep("gsk-fixture-malicious-pkg", "1.2.3"))).toBe(true);
    expect(advisoryMatches(APPROVED, dep("gsk-fixture-malicious-pkg", "2.0.0"))).toBe(true);
    expect(advisoryMatches(APPROVED, dep("gsk-fixture-malicious-pkg", "2.0.3"))).toBe(true);
    expect(advisoryMatches(APPROVED, dep("gsk-fixture-malicious-pkg", "2.0.4"))).toBe(false);
    expect(advisoryMatches(APPROVED, dep("gsk-fixture-malicious-pkg", "1.2.4"))).toBe(false);
    expect(advisoryMatches(APPROVED, dep("other-pkg", "1.2.3"))).toBe(false);
    expect(advisoryMatches(APPROVED, { ...dep("gsk-fixture-malicious-pkg", "1.x"), versionStatus: "non-semver" })).toBe(false);
  });

  it("never matches a record that is not approved", () => {
    expect(advisoryMatches(PROPOSED, dep("gsk-fixture-clean-pkg", "3.0.0"))).toBe(false);
    expect(advisoryMatches({ ...APPROVED, status: "rejected" }, dep("gsk-fixture-malicious-pkg", "1.2.3"))).toBe(false);
  });

  it("builds a supply-chain-anomaly finding with the advisory's severity, sources and fix", () => {
    const f = buildAdvisoryFinding(dep("gsk-fixture-malicious-pkg", "1.2.3"), APPROVED, "2026-10-27T12:00:00.000Z");
    expect(f).toMatchObject({
      id: "GSK-ADV-2026-9001::gsk-fixture-malicious-pkg@1.2.3",
      kind: "supply-chain-anomaly",
      priority: "P1",
      rationale: ["advisory:GSK-ADV-2026-9001", "base:critical/direct-prod=P1", "fix-available"],
      remediation: { fixedVersions: ["2.0.4"] },
      source: { name: "gateseeker-advisories" },
    });
    expect(f.evidence.kind).toBe("supply-chain-anomaly");
    if (f.evidence.kind === "supply-chain-anomaly") expect(f.evidence.reviewedBy).toBe("test-reviewer");
    expect(f.references.map((r) => r.url)).toEqual(["https://example.com/report-a", "https://example.org/report-b"]);
  });

  it("loads a set from a file, keeps only approved records, reports invalid ones", async () => {
    const set = await loadAdvisories({ path: fixturePath("intel/advisories/approved-npm-synthetic.json") });
    expect(set.advisories.map((a) => a.id)).toEqual(["GSK-ADV-2026-9001"]);
    expect(set.origin).toContain("approved-npm-synthetic.json");
    expect(set.digest).toMatch(/^[0-9a-f]{16}$/);

    const mixed = parseAdvisoryJson(JSON.stringify([APPROVED, PROPOSED, { id: "bad" }]), "mixed");
    expect(mixed.advisories.map((a) => a.status)).toEqual(["approved", "proposed"]);
    expect(mixed.problems).toHaveLength(1);
    expect(mixed.problems[0]).toMatch(/^mixed\[2\]/);

    const missing = await loadAdvisories({ path: fixturePath("intel/advisories/does-not-exist.json") });
    expect(missing.advisories).toEqual([]);
    expect(missing.problems[0]).toMatch(/cannot read/);
  });

  it("the default resolution finds the checkout's approved directory (or an empty set) without throwing", async () => {
    const set = await loadAdvisories();
    expect(["bundled", "checkout:advisories/approved", "none"]).toContain(set.origin);
    expect(set.advisories.every((a) => a.status === "approved")).toBe(true);
  });
});

describe("scan with advisories", () => {
  const emptyOsv: typeof fetch = () => Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));

  it("reports advisory matches for direct and transitive copies and ignores proposed records", async () => {
    const r = await scan({
      lockfilePath: fixturePath("lockfiles/advisory-match.package-lock.json"),
      lockfileContent: readFixture("lockfiles/advisory-match.package-lock.json"),
      osv: { fetch: emptyOsv },
      advisories: { advisories: [APPROVED, PROPOSED], origin: "test", digest: "0000000000000000", problems: [] },
      now: fixedNow,
      runId: "t",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rep = r.report;
    expect(rep.findings.map((f) => `${f.priority} ${f.id}`)).toEqual([
      "P1 GSK-ADV-2026-9001::gsk-fixture-malicious-pkg@1.2.3",
      "P1 GSK-ADV-2026-9001::gsk-fixture-malicious-pkg@2.0.2",
    ]);
    expect(rep.summary.byKind["supply-chain-anomaly"]).toBe(2);
    expect(rep.gate.verdict).toBe("fail");
    // Advisory records are per dependency, alongside OSV records; OSV ones drive the query-state summary.
    expect(rep.queries.filter((q) => q.source === "gateseeker-advisories").map((q) => `${q.dependency}:${q.state}`)).toEqual([
      "gsk-fixture-clean-pkg@3.0.0:no-known-vulnerabilities",
      "gsk-fixture-malicious-pkg@1.2.3:vulnerable",
      "gsk-fixture-malicious-pkg@2.0.2:vulnerable",
      "gsk-fixture-malicious-pkg@2.0.4:no-known-vulnerabilities",
      "gsk-fixture-wrapper@1.0.0:no-known-vulnerabilities",
    ]);
    expect(rep.summary.byQueryState).toEqual({ vulnerable: 0, "no-known-vulnerabilities": 5, "query-failed": 0, "not-queried": 0 });
    expect(rep.sources.map((s) => s.name)).toEqual(["osv.dev", "gateseeker-advisories"]);
    expect(rep.sources[1]?.endpoint).toContain("1 approved");
  });

  it("surfaces advisory-set problems as run errors without failing the scan", async () => {
    const r = await scan({
      lockfilePath: fixturePath("lockfiles/direct-only.package-lock.json"),
      lockfileContent: readFixture("lockfiles/direct-only.package-lock.json"),
      osv: { fetch: emptyOsv },
      advisories: { advisories: [], origin: "test", digest: "0", problems: ["duplicate advisory id X"] },
      now: fixedNow,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.errors).toContain("Advisory set: duplicate advisory id X");
  });
});

describe("feed parser", () => {
  it("parses the recorded StepSecurity RSS and finds the Laravel-Lang post", () => {
    const r = parseFeed(readFixture("intel/feeds/stepsecurity-blog.rss.xml"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("rss");
    expect(r.entries.length).toBeGreaterThan(10);
    const laravel = r.entries.find((e) => /laravel-lang/i.test(e.title));
    expect(laravel?.link).toBe("https://www.stepsecurity.io/blog/laravel-lang-supply-chain-attack");
    expect(laravel?.publishedAt).toMatch(/^2026-0[56]-/); // the feed carries the post's last-updated date
    for (const e of r.entries) {
      expect(e.title).not.toMatch(/<|>/);
      expect(e.link).toMatch(/^https:\/\//);
    }
  });

  it("parses the recorded OpenSSF Atom feed", () => {
    const r = parseFeed(readFixture("intel/feeds/ossf-malicious-packages-commits.atom.xml"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("atom");
    expect(r.entries.length).toBe(20);
    expect(r.entries.every((e) => e.link.startsWith("https://github.com/ossf/malicious-packages/commit/"))).toBe(true);
    expect(r.entries.every((e) => e.publishedAt !== null)).toBe(true);
  });

  it("refuses documents with DOCTYPE or ENTITY and non-feed documents", () => {
    expect(parseFeed('<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&x;</title><link>https://a</link></item></channel></rss>')).toMatchObject({ ok: false, error: expect.stringMatching(/DOCTYPE or ENTITY/) as string });
    expect(parseFeed("<html><body>not a feed</body></html>")).toMatchObject({ ok: false });
    expect(parseFeed("")).toMatchObject({ ok: false });
  });

  it("flattens HTML in titles, decodes entities, drops entries without an https link", () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[<b>Bold</b> &amp; <i>italic</i> &#x1F600; &#8217;s]]></title><link>https://x.test/a?utm_source=rss</link><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate></item>
      <item><title>no link</title></item>
      <item><title>javascript link</title><link>javascript:alert(1)</link></item>
      <item><title>escaped\u0007control</title><link>https://x.test/b</link></item>
    </channel></rss>`;
    const r = parseFeed(xml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.title)).toEqual(["Bold & italic 😀 ’s", "escapedcontrol"]);
    expect(r.entries[0]?.publishedAt).toBe("2026-10-26T10:00:00.000Z");
    expect(decodeEntities("&lt;a&gt; &quot;q&quot; &#39;s &unknown;")).toBe("<a> \"q\" 's &unknown;");
    expect(stripTags("<p>a</p><br/>b")).toBe("a b");
  });

  it("caps the number of entries", () => {
    const items = Array.from({ length: 500 }, (_, i) => `<item><title>t${i}</title><link>https://x.test/${i}</link></item>`).join("");
    const r = parseFeed(`<rss><channel>${items}</channel></rss>`);
    expect(r.ok && r.entries.length).toBe(200);
  });
});

describe("collector", () => {
  const config = sourcesSchema.parse({
    keywords: ["supply chain", "malicious", "compromised"],
    sources: [
      { name: "step", publisher: "StepSecurity", url: "https://www.stepsecurity.io/blog/rss.xml" },
      { name: "ossf", publisher: "OpenSSF", url: "https://github.com/ossf/malicious-packages/commits/main.atom" },
      { name: "down", publisher: "Down", url: "https://down.test/feed" },
      { name: "off", publisher: "Off", url: "https://off.test/feed", enabled: false },
    ],
  });
  const feeds: Record<string, string> = {
    "https://www.stepsecurity.io/blog/rss.xml": readFixture("intel/feeds/stepsecurity-blog.rss.xml"),
    "https://github.com/ossf/malicious-packages/commits/main.atom": readFixture("intel/feeds/ossf-malicious-packages-commits.atom.xml"),
  };
  const fetchFn: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = feeds[url];
    if (body === undefined) return Promise.resolve(new Response("", { status: 503 }));
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } }));
  };
  const empty: CollectorState = { seen: {}, titles: {} };

  it("proposes relevant entries once, with candidates, and reports failed sources", async () => {
    const r = await collect({ config, state: empty, fetch: fetchFn, now: fixedNow, nextSequence: 1, maxAgeDays: 3650, maxProposals: 1000 });
    expect(r.stats.sources).toBe(3);
    expect(r.stats.fetched).toBe(2);
    expect(r.stats.failed).toBe(1);
    expect(r.errors).toEqual(["down: HTTP 503"]);
    expect(r.stats.proposed).toBeGreaterThan(5);
    expect(r.proposals.every((p) => p.advisory.status === "proposed" && p.advisory.review.reviewed_by === null)).toBe(true);
    expect(r.proposals.map((p) => p.advisory.id).slice(0, 2)).toEqual(["GSK-ADV-2026-0001", "GSK-ADV-2026-0002"]);
    const laravel = r.proposals.find((p) => /laravel-lang/i.test(p.entry.title));
    expect(laravel?.advisory.ecosystem).toBe("Packagist");
    // The real title names no vendor/package token, so the reviewer fills the packages in.
    expect(laravel?.candidates).toEqual([]);
    expect(laravel?.advisory.packages).toEqual([{ name: "UNKNOWN/fill-in", affected: {} }]);
    expect(laravel?.advisory.sources[0]).toMatchObject({ publisher: "StepSecurity", url: "https://www.stepsecurity.io/blog/laravel-lang-supply-chain-attack" });
    for (const p of r.proposals) {
      const v = validateAdvisory(p.advisory);
      expect(v.ok, `${p.fileName}: ${JSON.stringify(v)}`).toBe(true);
    }
    // Second run over the same feeds proposes nothing.
    const again = await collect({ config, state: r.state, fetch: fetchFn, now: fixedNow, nextSequence: 100, maxAgeDays: 3650, maxProposals: 1000 });
    expect(again.stats.proposed).toBe(0);
    expect(again.stats.duplicates).toBe(r.stats.proposed);
  });

  it("remembers old entries without proposing them, and defers entries over the per-run cap", async () => {
    const stepOnly = { ...config, sources: [config.sources[0]!] };
    const all = await collect({ config: stepOnly, state: empty, fetch: fetchFn, now: fixedNow, nextSequence: 1, maxAgeDays: 3650, maxProposals: 1000 });
    expect(all.stats.proposed).toBeGreaterThan(3);

    const recent = await collect({ config: stepOnly, state: empty, fetch: fetchFn, now: fixedNow, nextSequence: 1, maxAgeDays: 30, maxProposals: 1000 });
    expect(recent.stats.tooOld).toBeGreaterThan(0);
    expect(recent.stats.proposed + recent.stats.tooOld).toBe(all.stats.proposed);
    expect(recent.proposals.every((p) => p.entry.publishedAt === null || Date.parse(p.entry.publishedAt) >= fixedNow().getTime() - 30 * 86_400_000)).toBe(true);
    // Old entries are in the state so they are never proposed later.
    expect(Object.keys(recent.state.seen).length).toBe(all.stats.proposed);

    const capped = await collect({ config: stepOnly, state: empty, fetch: fetchFn, now: fixedNow, nextSequence: 1, maxAgeDays: 3650, maxProposals: 2 });
    expect(capped.stats.proposed).toBe(2);
    expect(capped.stats.deferred).toBe(all.stats.proposed - 2);
    // Deferred entries are not in the state, so the next run proposes them.
    const next = await collect({ config: stepOnly, state: capped.state, fetch: fetchFn, now: fixedNow, nextSequence: 3, maxAgeDays: 3650, maxProposals: 1000 });
    expect(next.stats.proposed).toBe(all.stats.proposed - 2);
    expect(next.stats.duplicates).toBe(2);
  });

  it("filters irrelevant titles and treats tracking parameters as the same URL", () => {
    expect(isRelevant("Weekly product update", ["malicious"])).toBe(false);
    expect(isRelevant("Malicious npm package found", ["malicious"])).toBe(true);
    expect(canonicalUrl("https://X.test/a/?utm_source=rss&utm_medium=feed&b=1#frag")).toBe(canonicalUrl("https://x.test/a?b=1"));
    expect(titleHash("Laravel-Lang: Supply Chain!")).toBe(titleHash("laravel lang supply chain"));
  });

  it("extracts composer, scoped and versioned npm candidates", () => {
    expect(extractCandidates("Laravel-Lang Supply Chain Attack: laravel-lang/lang and laravel-lang/attributes rewritten")).toEqual(["laravel-lang/lang", "laravel-lang/attributes"]);
    expect(extractCandidates("Malicious @acme/widgets and left-pad@1.3.0 found on npm")).toEqual(["@acme/widgets", "left-pad@1.3.0"]);
    expect(extractCandidates("Weekly roundup 10/27")).toEqual([]);
    expect(extractCandidates("ChainDrop npm Worm: Bun-loaded CI/CD credential harvester")).toEqual([]);
    expect(extractCandidates("See https://example.com/vendor/pkg for details")).toEqual([]);
  });

  it("refuses oversized bodies, timeouts and cross-host redirects", async () => {
    const big: typeof fetch = () => Promise.resolve(new Response("x".repeat(10), { status: 200, headers: { "content-length": "99999999" } }));
    const r1 = await collect({ config: { ...config, sources: [config.sources[0]!] }, state: empty, fetch: big, nextSequence: 1, maxBytes: 1000 });
    expect(r1.errors[0]).toMatch(/exceeds 1000/);

    const redirect: typeof fetch = () => Promise.resolve(new Response("", { status: 302, headers: { location: "https://evil.test/feed" } }));
    const r2 = await collect({ config: { ...config, sources: [config.sources[0]!] }, state: empty, fetch: redirect, nextSequence: 1 });
    expect(r2.errors[0]).toMatch(/redirect to another host refused/);

    const hang: typeof fetch = (_u, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () => {
          rej(new DOMException("aborted", "AbortError"));
        });
      });
    const r3 = await collect({ config: { ...config, sources: [config.sources[0]!] }, state: empty, fetch: hang, nextSequence: 1, timeoutMs: 20 });
    expect(r3.errors[0]).toMatch(/timed out/);
  });

  it("runCollect writes proposals and state into a checkout layout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gateseeker-intel-"));
    try {
      await mkdir(join(dir, "advisories", "approved"), { recursive: true });
      await writeFile(join(dir, "advisories", "sources.json"), JSON.stringify({ keywords: ["compromised", "supply chain"], sources: [{ name: "step", publisher: "StepSecurity", url: "https://www.stepsecurity.io/blog/rss.xml" }] }));
      await writeFile(join(dir, "advisories", "approved", "a.json"), JSON.stringify({ ...APPROVED, id: "GSK-ADV-2026-0007" }));
      const r = await runCollect(dir, { fetch: fetchFn, now: fixedNow, maxAgeDays: 3650, maxProposals: 1000 });
      expect(r.written.length).toBe(r.stats.proposed);
      expect(r.stats.proposed).toBeGreaterThan(0);
      expect(r.proposals[0]?.advisory.id).toBe("GSK-ADV-2026-0008"); // continues after the highest existing id of the year
      const files = await readdir(join(dir, "advisories", "proposed"));
      expect(files.length).toBe(r.stats.proposed);
      const state = JSON.parse(await readFile(join(dir, "advisories", ".state", "seen.json"), "utf8")) as CollectorState;
      expect(Object.keys(state.seen).length).toBe(r.stats.proposed);

      const dry = await runCollect(dir, { fetch: fetchFn, now: fixedNow, dryRun: true, maxAgeDays: 3650, maxProposals: 1000 });
      expect(dry.written).toEqual([]);
      expect(dry.stats.proposed).toBe(0); // everything is already in the state
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("gateseeker-intel CLI", () => {
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      io: {
        stdout: (s: string) => {
          out.push(s);
        },
        stderr: (s: string) => {
          err.push(s);
        },
      },
      stdout: () => out.join(""),
      stderr: () => err.join(""),
    };
  }

  it("validates the repository's own advisories and builds only approved ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gateseeker-intel-cli-"));
    try {
      await mkdir(join(dir, "advisories", "approved"), { recursive: true });
      await mkdir(join(dir, "advisories", "proposed"), { recursive: true });
      await writeFile(join(dir, "advisories", "approved", "ok.json"), JSON.stringify(APPROVED));
      await writeFile(join(dir, "advisories", "proposed", "p.json"), JSON.stringify(PROPOSED));
      const c = capture();
      expect(await intelMain(["validate", "--root", dir], c.io)).toBe(0);
      expect(c.stdout()).toContain("2 record(s) validated: 1 approved, 1 proposed");

      const out = join(dir, "advisories.json");
      const b = capture();
      expect(await intelMain(["build", "--root", dir, "--out", out], b.io)).toBe(0);
      const built = JSON.parse(await readFile(out, "utf8")) as Advisory[];
      expect(built.map((a) => a.id)).toEqual(["GSK-ADV-2026-9001"]);

      // A proposed record placed in approved/ is a status/directory mismatch.
      await writeFile(join(dir, "advisories", "approved", "wrong.json"), JSON.stringify(PROPOSED));
      const d = capture();
      expect(await intelMain(["validate", "--root", dir], d.io)).toBe(1);
      expect(d.stderr()).toMatch(/status "proposed" does not match directory "approved"/);
      expect(d.stderr()).toMatch(/duplicate id GSK-ADV-2026-9002/);
      const e = capture();
      expect(await intelMain(["build", "--root", dir, "--out", out], e.io)).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("validates the real checkout", async () => {
    const c = capture();
    const code = await intelMain(["validate", "--root", fixturePath("..")], c.io);
    expect(c.stderr()).toBe("");
    expect(code).toBe(0);
  });

  it("usage errors exit 3", async () => {
    const a = capture();
    expect(await intelMain([], a.io)).toBe(3);
    const b = capture();
    expect(await intelMain(["frobnicate", "--root", fixturePath("..")], b.io)).toBe(3);
    const c = capture();
    expect(await intelMain(["validate", "--root", fixturePath("lockfiles")], c.io)).toBe(3);
  });
});

import { describe, expect, it, vi } from "vitest";
import { OsvClient } from "../src/intel/osv.js";
import type { Dependency } from "../src/types.js";
import { readFixture } from "./helpers.js";

type FetchFn = typeof fetch;

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Routes requests by package name to canned bodies; records every request body. */
function routedFetch(routes: Record<string, string | (() => Response | Promise<Response>)>) {
  const calls: { name: string; version: string; page_token: string | undefined }[] = [];
  const fetchFn: FetchFn = async (_url, init) => {
    const body = JSON.parse(init?.body as string) as {
      package: { name: string };
      version: string;
      page_token?: string;
    };
    calls.push({ name: body.package.name, version: body.version, page_token: body.page_token });
    const route = routes[body.package.name];
    if (route === undefined) return jsonResponse("{}", 404);
    return typeof route === "string" ? jsonResponse(route) : await route();
  };
  return { fetchFn, calls };
}

const fixedNow = () => new Date("2026-10-27T12:00:00.000Z");

function dep(name: string, version: string | null, status: Dependency["versionStatus"] = "ok"): Dependency {
  return {
    name,
    version,
    ecosystem: "npm",
    versionStatus: status,
    exposure: { direct: true, production: true },
    paths: [`node_modules/${name}`],
  };
}

describe("OsvClient.query", () => {
  it("returns known vulnerabilities with ids preserved (real recorded response)", async () => {
    const { fetchFn, calls } = routedFetch({ lodash: readFixture("osv/lodash-4.17.20.json") });
    const client = new OsvClient({ fetch: fetchFn, now: fixedNow });

    const out = await client.query({ name: "lodash", version: "4.17.20", ecosystem: "npm" });

    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.queriedAt).toBe("2026-10-27T12:00:00.000Z");
    expect(out.vulns.map((v) => v.id).sort()).toEqual([
      "GHSA-29mw-wpgm-hmr9",
      "GHSA-35jh-r3h4-6jhm",
      "GHSA-f23m-r3pf-42rh",
      "GHSA-r5fr-rjxr-66jc",
      "GHSA-xxjr-mmjv-4gpg",
    ]);
    const cmdInjection = out.vulns.find((v) => v.id === "GHSA-35jh-r3h4-6jhm");
    expect(cmdInjection?.aliases).toEqual(["CVE-2021-23337"]);
    expect(cmdInjection?.database_specific?.severity).toBe("HIGH");
    expect(calls).toEqual([{ name: "lodash", version: "4.17.20", page_token: undefined }]);
  });

  it("returns an empty ok result when the source reports no vulnerabilities", async () => {
    const { fetchFn } = routedFetch({ zod: readFixture("osv/zod-4.6.7.json") });
    const client = new OsvClient({ fetch: fetchFn, now: fixedNow });

    const out = await client.query({ name: "zod", version: "4.6.7", ecosystem: "npm" });

    expect(out).toEqual({ status: "ok", vulns: [], queriedAt: "2026-10-27T12:00:00.000Z" });
  });

  it("treats a response outside the OSV schema as a failed query, not as clean", async () => {
    const { fetchFn } = routedFetch({ pkg: readFixture("osv/invalid-schema.json") });
    const client = new OsvClient({ fetch: fetchFn });

    const out = await client.query({ name: "pkg", version: "1.0.0", ecosystem: "npm" });

    expect(out.status).toBe("failed");
    if (out.status !== "failed") return;
    expect(out.error).toMatch(/does not match the OSV schema/);
    expect(out.error).toMatch(/vulns/);
  });

  it("treats non-JSON bodies as failed queries", async () => {
    const { fetchFn } = routedFetch({ pkg: () => new Response("<html>oops</html>", { status: 200 }) });
    const out = await new OsvClient({ fetch: fetchFn }).query({ name: "pkg", version: "1.0.0", ecosystem: "npm" });
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.error).toMatch(/not valid JSON/);
  });

  it("treats HTTP errors as failed queries", async () => {
    const { fetchFn } = routedFetch({ pkg: () => jsonResponse('{"code":13}', 503) });
    const out = await new OsvClient({ fetch: fetchFn }).query({ name: "pkg", version: "1.0.0", ecosystem: "npm" });
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.error).toMatch(/^HTTP 503/);
  });

  it("treats network failures as failed queries", async () => {
    const fetchFn: FetchFn = () => Promise.reject(new TypeError("fetch failed: ECONNREFUSED"));
    const out = await new OsvClient({ fetch: fetchFn }).query({ name: "pkg", version: "1.0.0", ecosystem: "npm" });
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.error).toBe("Network error: fetch failed: ECONNREFUSED");
  });

  it("aborts after the timeout and reports it", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn: FetchFn = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      const client = new OsvClient({ fetch: fetchFn, timeoutMs: 250 });
      const pending = client.query({ name: "slow", version: "1.0.0", ecosystem: "npm" });
      await vi.advanceTimersByTimeAsync(251);
      const out = await pending;
      expect(out).toMatchObject({ status: "failed", error: "Request timed out after 250 ms." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows next_page_token until exhausted and merges pages", async () => {
    let page = 0;
    const { fetchFn, calls } = routedFetch({
      paged: () => {
        page++;
        if (page === 1) return jsonResponse(JSON.stringify({ vulns: [{ id: "A-1" }], next_page_token: "t2" }));
        if (page === 2) return jsonResponse(JSON.stringify({ next_page_token: "t3" })); // token-only page
        return jsonResponse(JSON.stringify({ vulns: [{ id: "A-2" }] }));
      },
    });
    const out = await new OsvClient({ fetch: fetchFn }).query({ name: "paged", version: "1.0.0", ecosystem: "npm" });
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.vulns.map((v) => v.id)).toEqual(["A-1", "A-2"]);
    expect(calls.map((c) => c.page_token)).toEqual([undefined, "t2", "t3"]);
  });

  it("fails instead of looping forever when pagination never ends", async () => {
    const { fetchFn, calls } = routedFetch({
      forever: () => jsonResponse(JSON.stringify({ vulns: [{ id: "X" }], next_page_token: "again" })),
    });
    const out = await new OsvClient({ fetch: fetchFn }).query({ name: "forever", version: "1.0.0", ecosystem: "npm" });
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.error).toMatch(/Pagination exceeded/);
    expect(calls.length).toBe(20);
  });

  it("memoises identical queries within one client", async () => {
    const { fetchFn, calls } = routedFetch({ zod: "{}" });
    const client = new OsvClient({ fetch: fetchFn });
    await Promise.all([
      client.query({ name: "zod", version: "4.6.7", ecosystem: "npm" }),
      client.query({ name: "zod", version: "4.6.7", ecosystem: "npm" }),
    ]);
    await client.query({ name: "zod", version: "4.6.7", ecosystem: "npm" });
    expect(calls).toHaveLength(1);
  });
});

describe("OsvClient.queryAll", () => {
  it("skips dependencies without a registry-resolvable version", async () => {
    const { fetchFn, calls } = routedFetch({ zod: "{}" });
    const client = new OsvClient({ fetch: fetchFn });
    const results = await client.queryAll([
      dep("zod", "4.6.7"),
      dep("no-version", null, "missing"),
      dep("git-pkg", "1.2.3", "non-registry"),
      dep("weird", "1.x", "non-semver"),
    ]);
    expect([...results.keys()]).toEqual(["zod@4.6.7"]);
    expect(calls).toHaveLength(1);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFn: FetchFn = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return jsonResponse("{}");
    };
    const client = new OsvClient({ fetch: fetchFn, concurrency: 2 });
    const deps = Array.from({ length: 9 }, (_, i) => dep(`p${i}`, "1.0.0"));
    const results = await client.queryAll(deps);
    expect(results.size).toBe(9);
    expect(maxInFlight).toBe(2);
  });

  it("reports partial failure per dependency, keeping successes", async () => {
    const { fetchFn } = routedFetch({
      good: "{}",
      bad: () => jsonResponse("{}", 500),
    });
    const results = await new OsvClient({ fetch: fetchFn }).queryAll([dep("good", "1.0.0"), dep("bad", "1.0.0")]);
    expect(results.get("good@1.0.0")?.status).toBe("ok");
    expect(results.get("bad@1.0.0")?.status).toBe("failed");
  });
});

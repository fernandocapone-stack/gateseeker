import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ADVISORY_ECOSYSTEMS, type Advisory } from "../advisory-schema.js";
import { parseFeed, type FeedEntry } from "./rss.js";

/**
 * Collector: fetch configured feeds, keep relevant entries, extract package
 * candidates, deduplicate against the committed state, and write proposals.
 * No model of any kind; extraction is lexical. Network goes through an
 * injected fetch so tests stay offline.
 */

export const sourcesSchema = z.strictObject({
  /** Incident words: at least one must appear in the title. */
  keywords: z.array(z.string().min(2)).min(1),
  /** Ecosystem/context words: when present, at least one must also appear. */
  contextKeywords: z.array(z.string().min(2)).default([]),
  sources: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        publisher: z.string().min(1),
        url: z.url().refine((u) => u.startsWith("https://"), "https only"),
        enabled: z.boolean().default(true),
      }),
    )
    .min(1),
});
export type SourcesConfig = z.infer<typeof sourcesSchema>;

export interface CollectorState {
  /** canonical URL -> first seen ISO date */
  seen: Record<string, string>;
  /** normalized-title hash -> canonical URL */
  titles: Record<string, string>;
}

export interface CollectOptions {
  config: SourcesConfig;
  state: CollectorState;
  fetch?: typeof fetch;
  /** OSV query endpoint used to mark candidates already covered upstream; null disables the check. */
  osvEndpoint?: string | null;
  now?: () => Date;
  timeoutMs?: number;
  maxBytes?: number;
  /** Next free sequence number for ids this year. */
  nextSequence: number;
  /** Entries older than this are remembered as seen but not proposed (default 30). */
  maxAgeDays?: number;
  /** Proposals per run; the rest stays unseen for the next run (default 25). */
  maxProposals?: number;
}

export interface Proposal {
  fileName: string;
  advisory: Advisory;
  entry: FeedEntry & { publisher: string };
  candidates: string[];
}

export interface CollectResult {
  proposals: Proposal[];
  state: CollectorState;
  stats: { sources: number; fetched: number; failed: number; entries: number; relevant: number; duplicates: number; tooOld: number; deferred: number; proposed: number; coveredUpstream: number };
  errors: string[];
}

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_cid|mc_eid|ref$|source$)/i;

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export function titleHash(title: string): string {
  const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function isRelevant(title: string, keywords: string[], contextKeywords: string[] = []): boolean {
  const t = title.toLowerCase();
  const incident = keywords.some((k) => t.includes(k.toLowerCase()));
  if (!incident) return false;
  if (contextKeywords.length === 0) return true;
  return contextKeywords.some((k) => t.includes(k.toLowerCase()));
}

const COMPOSER_RE = /\b([a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?)\b/g;
const NPM_SCOPED_RE = /(@[a-z0-9][a-z0-9-_.]*\/[a-z0-9][a-z0-9-_.]*)/g;
const NPM_VERSIONED_RE = /\b([a-z0-9][a-z0-9-_.]*)@(\d+\.\d+\.\d+)\b/g;
const NOT_PACKAGES = new Set(["http", "https", "www", "blog", "github.com", "npm", "composer", "pypi", "node", "and", "or", "the", "ci", "cd", "ci/cd", "io", "dev", "com", "org", "net"]);

/** Lexical extraction of package-like tokens from a title. Candidates only; a human confirms. */
export function extractCandidates(title: string): string[] {
  const out = new Set<string>();
  const t = title.replace(/https?:\/\/\S+/gi, " ");
  for (const m of t.matchAll(NPM_SCOPED_RE)) out.add(m[1] ?? "");
  for (const m of t.matchAll(NPM_VERSIONED_RE)) if (m[1] && m[2]) out.add(`${m[1]}@${m[2]}`);
  // Scoped npm names look like vendor/package once the "@" is dropped; remove them first.
  const withoutScoped = t.replace(NPM_SCOPED_RE, " ").toLowerCase();
  for (const m of withoutScoped.matchAll(COMPOSER_RE)) {
    const a = m[1] ?? "";
    const b = m[2] ?? "";
    if (NOT_PACKAGES.has(a) || NOT_PACKAGES.has(b) || /^\d+$/.test(a) || /^\d+$/.test(b)) continue;
    out.add(`${a}/${b}`);
  }
  return [...out].filter((c) => c.length > 0).slice(0, 10);
}

function guessEcosystem(title: string, candidates: string[]): (typeof ADVISORY_ECOSYSTEMS)[number] {
  const t = title.toLowerCase();
  if (candidates.some((c) => c.startsWith("@")) || /\bnpm\b|node\.js|javascript/.test(t)) return "npm";
  if (/composer|packagist|laravel|php|symfony/.test(t)) return "Packagist";
  if (/pypi|python|pip\b/.test(t)) return "PyPI";
  if (/rubygems|ruby\b|gem\b/.test(t)) return "RubyGems";
  if (/crates\.io|cargo|rust\b/.test(t)) return "crates.io";
  if (/golang|\bgo module/.test(t)) return "Go";
  return "other";
}

const OSV_ECOSYSTEMS: Record<string, string> = { npm: "npm", Packagist: "Packagist", PyPI: "PyPI", RubyGems: "RubyGems", "crates.io": "crates.io", Go: "Go" };

/** Asks OSV whether any candidate package already has records; failures never block a proposal. */
export async function osvCoverage(candidates: string[], ecosystem: string, fetchFn: typeof fetch, endpoint: string, timeoutMs: number): Promise<{ ids: string[]; packages: string[] }> {
  const eco = OSV_ECOSYSTEMS[ecosystem];
  const ids = new Set<string>();
  const packages: string[] = [];
  if (!eco) return { ids: [], packages };
  for (const raw of candidates.slice(0, 5)) {
    const name = raw.replace(/@\d+\.\d+\.\d+$/, "");
    if (name.includes("/") && eco === "npm" && !name.startsWith("@")) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const res = await fetchFn(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package: { name, ecosystem: eco } }), signal: controller.signal });
      if (!res.ok) continue;
      const json = (await res.json()) as { vulns?: { id?: unknown; aliases?: unknown }[] };
      const found = (json.vulns ?? []).filter((v) => typeof v.id === "string");
      if (found.length === 0) continue;
      packages.push(name);
      for (const v of found) {
        ids.add(v.id as string);
        for (const a of Array.isArray(v.aliases) ? v.aliases : []) if (typeof a === "string") ids.add(a);
      }
    } catch {
      /* unreachable OSV must not block the proposal */
    } finally {
      clearTimeout(timer);
    }
  }
  return { ids: [...ids].sort(), packages };
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "entry";
}

async function fetchText(url: string, fetchFn: typeof fetch, timeoutMs: number, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "user-agent": "gateseeker-intel/0.1 (+https://github.com/gateseeker-dev/gateseeker)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") ?? "";
      let sameHost = false;
      try {
        sameHost = new URL(loc, url).hostname === new URL(url).hostname;
      } catch {
        sameHost = false;
      }
      if (!sameHost) return { ok: false, error: `redirect to another host refused (${res.status})` };
      const res2 = await fetchFn(new URL(loc, url).toString(), { signal: controller.signal, redirect: "manual" });
      if (!res2.ok) return { ok: false, error: `HTTP ${res2.status} after redirect` };
      return await readBounded(res2, maxBytes);
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return await readBounded(res, maxBytes);
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, error: `timed out after ${timeoutMs} ms` };
    return { ok: false, error: `network error: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function readBounded(res: Response, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, error: `body of ${declared} bytes exceeds ${maxBytes}` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) return { ok: false, error: `body of ${buf.length} bytes exceeds ${maxBytes}` };
  return { ok: true, text: buf.toString("utf8") };
}

export async function collect(options: CollectOptions): Promise<CollectResult> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const state: CollectorState = { seen: { ...options.state.seen }, titles: { ...options.state.titles } };
  const stats = { sources: 0, fetched: 0, failed: 0, entries: 0, relevant: 0, duplicates: 0, tooOld: 0, deferred: 0, proposed: 0, coveredUpstream: 0 };
  const osvEndpoint = options.osvEndpoint === undefined ? "https://api.osv.dev/v1/query" : options.osvEndpoint;
  const maxAgeMs = (options.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000;
  const maxProposals = options.maxProposals ?? 25;
  const errors: string[] = [];
  const proposals: Proposal[] = [];
  let seq = options.nextSequence;
  const nowIso = now().toISOString();
  const year = nowIso.slice(0, 4);

  for (const source of options.config.sources) {
    if (!source.enabled) continue;
    stats.sources++;
    const fetched = await fetchText(source.url, fetchFn, timeoutMs, maxBytes);
    if (!fetched.ok) {
      stats.failed++;
      errors.push(`${source.name}: ${fetched.error}`);
      continue;
    }
    stats.fetched++;
    const parsed = parseFeed(fetched.text);
    if (!parsed.ok) {
      stats.failed++;
      errors.push(`${source.name}: ${parsed.error}`);
      continue;
    }
    for (const entry of parsed.entries) {
      stats.entries++;
      if (!isRelevant(entry.title, options.config.keywords, options.config.contextKeywords)) continue;
      stats.relevant++;
      const url = canonicalUrl(entry.link);
      const th = titleHash(entry.title);
      if (state.seen[url] !== undefined || state.titles[th] !== undefined) {
        stats.duplicates++;
        continue;
      }
      // Old entries are remembered so a fresh checkout does not propose years of history.
      if (entry.publishedAt !== null && now().getTime() - Date.parse(entry.publishedAt) > maxAgeMs) {
        stats.tooOld++;
        state.seen[url] = nowIso;
        state.titles[th] = url;
        continue;
      }
      // Over the cap: leave unseen so the next run picks it up.
      if (proposals.length >= maxProposals) {
        stats.deferred++;
        continue;
      }
      state.seen[url] = nowIso;
      state.titles[th] = url;

      const candidates = extractCandidates(entry.title);
      const id = `GSK-ADV-${year}-${String(seq++).padStart(4, "0")}`;
      const ecosystem = guessEcosystem(entry.title, candidates);
      const coverage = osvEndpoint === null ? null : await osvCoverage(candidates, ecosystem, fetchFn, osvEndpoint, timeoutMs);
      if (coverage !== null && coverage.ids.length > 0) stats.coveredUpstream++;
      const advisory: Advisory = {
        id,
        status: "proposed",
        type: "other",
        severity: "HIGH",
        ecosystem,
        packages: (candidates.length > 0 ? candidates : ["UNKNOWN/fill-in"]).map((name) => ({ name: name.replace(/@\d+\.\d+\.\d+$/, ""), affected: {} })),
        window: { start: entry.publishedAt, end: null },
        indicators: [],
        summary: "TODO: one line written by the reviewer after reading the source.",
        remediation: "TODO: concrete action written by the reviewer.",
        sources: [{ url: entry.link, publisher: source.publisher, title: entry.title, published_at: (entry.publishedAt ?? nowIso).slice(0, 10) }],
        review: { proposed_by: "collector", proposed_at: nowIso, reviewed_by: null, reviewed_at: null, notes: null },
        upstream: { osv: null, ghsa: null },
        ...(coverage !== null && coverage.ids.length > 0
          ? {
              draft: {
                upstream: { osv: coverage.ids.find((i) => !i.startsWith("GHSA-")) ?? null, ghsa: coverage.ids.find((i) => i.startsWith("GHSA-")) ?? null },
                notes: `Already covered by OSV (${coverage.ids.slice(0, 4).join(", ")}) for ${coverage.packages.join(", ")}; the scanner reports it through OSV. Reject as duplicate unless this record adds something OSV lacks.`,
              },
            }
          : {}),
      };
      proposals.push({
        fileName: `${(entry.publishedAt ?? nowIso).slice(0, 10)}-${slugify(entry.title)}.json`,
        advisory,
        entry: { ...entry, publisher: source.publisher },
        candidates,
      });
      stats.proposed++;
    }
  }

  return { proposals, state, stats, errors };
}

/** Reads config and state from a checkout, runs the collector, writes proposals and state. */
export async function runCollect(root: string, options: { fetch?: typeof fetch; now?: () => Date; dryRun?: boolean; maxAgeDays?: number; maxProposals?: number; osvEndpoint?: string | null } = {}): Promise<CollectResult & { written: string[] }> {
  const advisoriesDir = join(root, "advisories");
  const config = sourcesSchema.parse(JSON.parse(await readFile(join(advisoriesDir, "sources.json"), "utf8")));
  let state: CollectorState = { seen: {}, titles: {} };
  try {
    const raw = JSON.parse(await readFile(join(advisoriesDir, ".state", "seen.json"), "utf8")) as Partial<CollectorState>;
    state = { seen: raw.seen ?? {}, titles: raw.titles ?? {} };
  } catch {
    /* first run */
  }
  const nextSequence = await nextSequenceNumber(advisoriesDir, (options.now ?? (() => new Date()))().getUTCFullYear());
  const result = await collect({
    config,
    state,
    nextSequence,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.maxAgeDays !== undefined ? { maxAgeDays: options.maxAgeDays } : {}),
    ...(options.maxProposals !== undefined ? { maxProposals: options.maxProposals } : {}),
    ...(options.osvEndpoint !== undefined ? { osvEndpoint: options.osvEndpoint } : {}),
  });

  const written: string[] = [];
  if (!options.dryRun) {
    await mkdir(join(advisoriesDir, "proposed"), { recursive: true });
    for (const p of result.proposals) {
      const path = join(advisoriesDir, "proposed", p.fileName);
      await writeFile(path, `${JSON.stringify(p.advisory, null, 2)}\n`, "utf8");
      written.push(path);
    }
    await mkdir(join(advisoriesDir, ".state"), { recursive: true });
    await writeFile(join(advisoriesDir, ".state", "seen.json"), `${JSON.stringify(result.state, null, 2)}\n`, "utf8");
  }
  return { ...result, written };
}

async function nextSequenceNumber(advisoriesDir: string, year: number): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  let max = 0;
  for (const sub of ["approved", "proposed", "rejected"]) {
    let names: string[];
    try {
      names = await readdir(join(advisoriesDir, sub));
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      try {
        const j = JSON.parse(await readFile(join(advisoriesDir, sub, n), "utf8")) as { id?: string };
        const m = /^GSK-ADV-(\d{4})-(\d{4})$/.exec(j.id ?? "");
        if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
      } catch {
        /* invalid files are reported by validate, not here */
      }
    }
  }
  return max + 1;
}

export function summarize(result: CollectResult): string {
  const lines = [
    `sources ${result.stats.sources}, fetched ${result.stats.fetched}, failed ${result.stats.failed}`,
    `entries ${result.stats.entries}, relevant ${result.stats.relevant}, duplicates ${result.stats.duplicates}, too old ${result.stats.tooOld}, deferred to next run ${result.stats.deferred}, proposed ${result.stats.proposed} (already covered by OSV: ${result.stats.coveredUpstream})`,
  ];
  for (const p of result.proposals) {
    lines.push(`- [${p.advisory.id}] ${p.entry.publisher}: ${p.entry.title}`);
    lines.push(`  ${p.entry.link}`);
    lines.push(`  candidates: ${p.candidates.length > 0 ? p.candidates.join(", ") : "(none; fill in)"}`);
    const draft = p.advisory.draft as { upstream?: { osv?: string | null; ghsa?: string | null } } | undefined;
    if (draft?.upstream?.osv || draft?.upstream?.ghsa) lines.push(`  already covered by OSV: ${[draft.upstream.osv, draft.upstream.ghsa].filter(Boolean).join(", ")}`);
  }
  if (result.errors.length > 0) {
    lines.push("errors:");
    for (const e of result.errors) lines.push(`  - ${e}`);
  }
  return lines.join("\n");
}

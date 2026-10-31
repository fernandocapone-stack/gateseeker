#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { advisorySetFromText } from "./intel/advisories.js";
import { validateAdvisory, type Advisory } from "./intel/advisory-schema.js";
import { MIN_FEED_KEY_LENGTH, signFeed } from "./intel/feed-signature.js";
import { runCollect, summarize } from "./intel/feed/collect.js";
import { GATESEEKER_VERSION } from "./version.js";

/**
 * gateseeker-intel: maintainer-side commands for the curated advisory feed.
 *   collect   fetch feeds, write proposals and update state (run by the Action)
 *   validate  check every record under advisories/ against the schema
 *   build     compile advisories/approved into one JSON file for the scanner
 *   publish-feed  sign the built set and send it to the hosted service (run by the feed workflow)
 * Exit codes: 0 ok, 1 validation problems or a refused publication, 3 usage.
 */

const USAGE = `gateseeker-intel ${GATESEEKER_VERSION}

Usage:
  gateseeker-intel collect  [--root <dir>] [--dry-run] [--summary-file <file>] [--max-age-days <n>] [--max-proposals <n>]
  gateseeker-intel validate [--root <dir>]
  gateseeker-intel build    [--root <dir>] [--out <file>]
  gateseeker-intel ui       [--root <dir>] [--port <n>] [--no-open] [--no-merge-intel]
  gateseeker-intel publish-feed --url <service> [--root <dir>] [--file <advisories.json>]
                            (key in GATESEEKER_FEED_KEY; --file defaults to dist/advisories.json)

--root defaults to the repository checkout containing this build.
`;

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** Injected by tests; default process.env, global fetch and the system clock. */
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
}

function defaultRoot(): string {
  // dist/intel-cli.js -> repo root; src/intel-cli.ts (tsx) -> repo root
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export async function validateAll(root: string): Promise<{ records: { file: string; advisory: Advisory }[]; problems: string[] }> {
  const records: { file: string; advisory: Advisory }[] = [];
  const problems: string[] = [];
  const ids = new Map<string, string>();
  for (const sub of ["approved", "proposed", "rejected"]) {
    const dir = join(root, "advisories", sub);
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
    } catch {
      continue;
    }
    for (const n of names) {
      const file = join("advisories", sub, n);
      let json: unknown;
      try {
        json = JSON.parse(await readFile(join(dir, n), "utf8"));
      } catch (err) {
        problems.push(`${file}: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
        continue;
      }
      const v = validateAdvisory(json);
      if (!v.ok) {
        problems.push(...v.issues.map((i) => `${file}: ${i}`));
        continue;
      }
      const expectedStatus = sub === "approved" ? "approved" : sub === "rejected" ? "rejected" : "proposed";
      if (v.advisory.status !== expectedStatus && !(sub === "rejected" && v.advisory.status === "withdrawn")) {
        problems.push(`${file}: status "${v.advisory.status}" does not match directory "${sub}"`);
      }
      const prev = ids.get(v.advisory.id);
      if (prev !== undefined) problems.push(`${file}: duplicate id ${v.advisory.id} (also in ${prev})`);
      ids.set(v.advisory.id, file);
      records.push({ file, advisory: v.advisory });
    }
  }
  return { records, problems };
}

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        out: { type: "string" },
        url: { type: "string" },
        file: { type: "string" },
        "dry-run": { type: "boolean" },
        "summary-file": { type: "string" },
        "max-age-days": { type: "string" },
        "max-proposals": { type: "string" },
        port: { type: "string" },
        "no-open": { type: "boolean" },
        "no-merge-intel": { type: "boolean" },
        // Undocumented: fixed session token and UI directory for end-to-end tests.
        token: { type: "string" },
        "ui-dist": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 3;
  }
  const { values, positionals } = parsed;
  const command = positionals[0];
  if (values.help || command === undefined) {
    io.stdout(USAGE);
    return values.help ? 0 : 3;
  }
  const root = resolve(values.root ?? defaultRoot());
  try {
    await stat(join(root, "advisories"));
  } catch {
    io.stderr(`No advisories/ directory under ${root}. Use --root.\n`);
    return 3;
  }

  switch (command) {
    case "validate": {
      const { records, problems } = await validateAll(root);
      io.stdout(`${records.length} record(s) validated: ${records.filter((r) => r.advisory.status === "approved").length} approved, ${records.filter((r) => r.advisory.status === "proposed").length} proposed, ${records.filter((r) => r.advisory.status !== "approved" && r.advisory.status !== "proposed").length} rejected/withdrawn.\n`);
      for (const p of problems) io.stderr(`  - ${p}\n`);
      return problems.length === 0 ? 0 : 1;
    }
    case "build": {
      const { records, problems } = await validateAll(root);
      if (problems.length > 0) {
        for (const p of problems) io.stderr(`  - ${p}\n`);
        return 1;
      }
      const approved = records
        .filter((r) => r.advisory.status === "approved")
        .map((r) => {
          const rest: Advisory = { ...r.advisory };
          delete rest.draft;
          return rest;
        })
        .sort((a, b) => a.id.localeCompare(b.id));
      const out = resolve(values.out ?? join(root, "dist", "advisories.json"));
      await writeFile(out, `${JSON.stringify(approved, null, 2)}\n`, "utf8");
      io.stdout(`wrote ${approved.length} approved advisory record(s) to ${out}\n`);
      return 0;
    }
    case "collect": {
      const maxAgeDays = values["max-age-days"] !== undefined ? Number(values["max-age-days"]) : undefined;
      const maxProposals = values["max-proposals"] !== undefined ? Number(values["max-proposals"]) : undefined;
      if ((maxAgeDays !== undefined && !(Number.isInteger(maxAgeDays) && maxAgeDays > 0)) || (maxProposals !== undefined && !(Number.isInteger(maxProposals) && maxProposals > 0))) {
        io.stderr("--max-age-days and --max-proposals must be positive integers.\n");
        return 3;
      }
      const result = await runCollect(root, {
        dryRun: values["dry-run"] === true,
        ...(maxAgeDays !== undefined ? { maxAgeDays } : {}),
        ...(maxProposals !== undefined ? { maxProposals } : {}),
      });
      const summary = summarize(result);
      io.stdout(`${summary}\n`);
      if (values["summary-file"] !== undefined) await writeFile(resolve(values["summary-file"]), `${summary}\n`, "utf8");
      if (values["dry-run"]) io.stdout("(dry run: nothing written)\n");
      else io.stdout(`${result.written.length} proposal file(s) written; state updated.\n`);
      return 0;
    }
    case "ui": {
      const port = values.port !== undefined ? Number(values.port) : 0;
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        io.stderr("--port must be an integer between 0 and 65535.\n");
        return 3;
      }
      const { createUiServer } = await import("./intel/ui/server.js");
      const ui = createUiServer({
        root,
        mergeIntel: values["no-merge-intel"] !== true,
        ...(values.token !== undefined ? { token: values.token } : {}),
        ...(values["ui-dist"] !== undefined ? { uiDist: resolve(values["ui-dist"]) } : {}),
      });
      await new Promise<void>((resolveListen) => ui.server.listen(port, "127.0.0.1", resolveListen));
      const addr = ui.server.address();
      const actualPort = addr !== null && typeof addr !== "string" ? addr.port : port;
      const url = `http://127.0.0.1:${actualPort}/?token=${ui.token}`;
      io.stdout(`Gateseeker triage interface: ${url}\n(Only this machine can reach it. Press Ctrl+C to stop.)\n`);
      if (values["no-open"] !== true) openBrowser(url);
      await new Promise<void>(() => {
        /* run until interrupted */
      });
      return 0;
    }
    case "publish-feed":
      return publishFeed(root, values.url, values.file, io);
    default:
      io.stderr(`Unknown command "${command}".\n\n${USAGE}`);
      return 3;
  }
}

/**
 * Signs the built advisory set and sends it to POST /api/feed/published
 * (docs/SPRINT_6.md 3.5). The service checks the signature, stores the set,
 * queues the followed repositories of the ecosystems that changed and
 * rescans them, so the call can take a few minutes.
 */
async function publishFeed(root: string, url: string | undefined, file: string | undefined, io: Io): Promise<number> {
  const env = io.env ?? process.env;
  const key = env.GATESEEKER_FEED_KEY ?? "";
  if (key.length < MIN_FEED_KEY_LENGTH) {
    io.stderr(`GATESEEKER_FEED_KEY must be set to at least ${String(MIN_FEED_KEY_LENGTH)} characters.\n`);
    return 3;
  }
  let endpoint: URL;
  try {
    endpoint = new URL("/api/feed/published", url);
  } catch {
    io.stderr("--url must be the service address, for example https://gateseeker.vercel.app\n");
    return 3;
  }
  const local = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1";
  if (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) {
    io.stderr("--url must use https (http only for localhost).\n");
    return 3;
  }
  const path = resolve(file ?? join(root, "dist", "advisories.json"));
  let payload: string;
  try {
    payload = await readFile(path, "utf8");
  } catch {
    io.stderr(`Cannot read ${path}. Run "gateseeker-intel build" first.\n`);
    return 3;
  }
  const set = advisorySetFromText(payload, path);
  if (set.problems.length > 0) {
    for (const problem of set.problems) io.stderr(`  - ${problem}\n`);
    return 1;
  }
  const publishedAt = (io.now ?? (() => new Date()))().toISOString();
  const body = JSON.stringify({ publishedAt, digest: set.digest, payload, signature: signFeed(key, publishedAt, set.digest, payload) });
  let res: Response;
  try {
    res = await (io.fetch ?? fetch)(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(330_000) });
  } catch (err) {
    io.stderr(`Could not reach ${endpoint.origin}: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  const text = await res.text();
  if (!res.ok) {
    io.stderr(`The service refused the set (HTTP ${String(res.status)}): ${text.slice(0, 500)}\n`);
    return 1;
  }
  io.stdout(`Published ${String(set.advisories.length)} approved record(s), digest ${set.digest}.\n${text.slice(0, 2000)}\n`);
  return 0;
}

function openBrowser(url: string): void {
  // Fixed commands with the URL as a single argument; nothing is interpolated into a shell.
  const [cmd, args] =
    process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href.replace(/\/\/\/+/, "///");

if (isDirectRun || process.env.GATESEEKER_INTEL_CLI === "1") {
  const code = await main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
  process.exitCode = code;
}

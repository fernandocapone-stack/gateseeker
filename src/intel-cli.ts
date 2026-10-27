#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { validateAdvisory, type Advisory } from "./intel/advisory-schema.js";
import { runCollect, summarize } from "./intel/feed/collect.js";
import { GATESEEKER_VERSION } from "./version.js";

/**
 * gateseeker-intel: maintainer-side commands for the curated advisory feed.
 *   collect   fetch feeds, write proposals and update state (run by the Action)
 *   validate  check every record under advisories/ against the schema
 *   build     compile advisories/approved into one JSON file for the scanner
 * Exit codes: 0 ok, 1 validation problems, 3 usage.
 */

const USAGE = `gateseeker-intel ${GATESEEKER_VERSION}

Usage:
  gateseeker-intel collect  [--root <dir>] [--dry-run] [--summary-file <file>] [--max-age-days <n>] [--max-proposals <n>]
  gateseeker-intel validate [--root <dir>]
  gateseeker-intel build    [--root <dir>] [--out <file>]

--root defaults to the repository checkout containing this build.
`;

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
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
        "dry-run": { type: "boolean" },
        "summary-file": { type: "string" },
        "max-age-days": { type: "string" },
        "max-proposals": { type: "string" },
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
        .map((r) => r.advisory)
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
    default:
      io.stderr(`Unknown command "${command}".\n\n${USAGE}`);
      return 3;
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

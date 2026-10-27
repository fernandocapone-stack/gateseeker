#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_PARSER_LIMITS } from "./parser/lockfile.js";
import { renderText } from "./report/text.js";
import { PRIORITIES } from "./rules/priority.js";
import { scan } from "./scan.js";
import type { Priority } from "./types.js";
import { GATESEEKER_VERSION } from "./version.js";

/**
 * Exit codes (documented in README):
 *   0 pass        every query completed, nothing at or above --fail-on
 *   1 fail        at least one finding at or above --fail-on
 *   2 incomplete  at least one query failed or was skipped; never 0
 *   3 usage       bad arguments, unreadable or rejected input
 */
export const EXIT = { pass: 0, fail: 1, incomplete: 2, usage: 3 } as const;

const USAGE = `gateseeker ${GATESEEKER_VERSION}

Usage: gateseeker scan <package-lock.json> [options]

Options:
  --format <text|json>     Output format (default: text)
  --output <file>          Also write the JSON report to <file>
  --fail-on <P1|P2|P3|P4>  Priority threshold for a failing gate (default: P2)
  --max-size <bytes>       Reject lockfiles larger than this (default: ${DEFAULT_PARSER_LIMITS.maxBytes})
  --max-deps <n>           Reject lockfiles with more packages than this (default: ${DEFAULT_PARSER_LIMITS.maxDependencies})
  --timeout <ms>           Per-request timeout for the OSV API (default: 10000)
  --concurrency <n>        Maximum simultaneous OSV requests (default: 5)
  --help, -h               Show this help
  --version, -v            Show version

Exit codes: 0 pass, 1 fail, 2 incomplete, 3 usage or rejected input.
`;

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function positiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--${name} must be a positive integer, got "${value}".`);
  return n;
}

class UsageError extends Error {}

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof optionSpec; allowPositionals: true }>>;
  const optionSpec = {
    format: { type: "string" },
    output: { type: "string" },
    "fail-on": { type: "string" },
    "max-size": { type: "string" },
    "max-deps": { type: "string" },
    timeout: { type: "string" },
    concurrency: { type: "string" },
    // Undocumented: lets tests point the client at a local server.
    "osv-endpoint": { type: "string" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  } as const;

  try {
    parsed = parseArgs({ args: argv, options: optionSpec, allowPositionals: true });
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return EXIT.usage;
  }

  const { values, positionals } = parsed;
  if (values.version) {
    io.stdout(`${GATESEEKER_VERSION}\n`);
    return EXIT.pass;
  }
  if (values.help || positionals.length === 0) {
    io.stdout(USAGE);
    return values.help ? EXIT.pass : EXIT.usage;
  }

  const [command, target] = positionals;
  if (command !== "scan" || target === undefined || positionals.length !== 2) {
    io.stderr(`Expected: gateseeker scan <package-lock.json>\n\n${USAGE}`);
    return EXIT.usage;
  }

  try {
    const format = values.format ?? "text";
    if (format !== "text" && format !== "json") throw new UsageError(`--format must be text or json, got "${format}".`);
    const failOn = (values["fail-on"] ?? "P2").toUpperCase();
    if (!(PRIORITIES as readonly string[]).includes(failOn)) {
      throw new UsageError(`--fail-on must be one of ${PRIORITIES.join(", ")}, got "${values["fail-on"] ?? ""}".`);
    }
    const maxBytes = positiveInt(values["max-size"], "max-size");
    const maxDependencies = positiveInt(values["max-deps"], "max-deps");
    const timeoutMs = positiveInt(values.timeout, "timeout");
    const concurrency = positiveInt(values.concurrency, "concurrency");

    const lockfilePath = resolve(target);
    let content: string;
    try {
      content = await readFile(lockfilePath, "utf8");
    } catch (err) {
      throw new UsageError(`Cannot read ${lockfilePath}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const result = await scan({
      lockfilePath,
      lockfileContent: content,
      failOn: failOn as Priority,
      limits: {
        ...(maxBytes !== undefined ? { maxBytes } : {}),
        ...(maxDependencies !== undefined ? { maxDependencies } : {}),
      },
      osv: {
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(concurrency !== undefined ? { concurrency } : {}),
        ...(values["osv-endpoint"] !== undefined ? { endpoint: values["osv-endpoint"] } : {}),
      },
    });

    if (!result.ok) {
      io.stderr(`Input rejected (${result.error.code}): ${result.error.message}\n`);
      return EXIT.usage;
    }

    const json = JSON.stringify(result.report, null, 2);
    if (values.output !== undefined) await writeFile(resolve(values.output), `${json}\n`, "utf8");
    io.stdout(format === "json" ? `${json}\n` : `${renderText(result.report)}\n`);

    return EXIT[result.report.gate.verdict];
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`${err.message}\n`);
      return EXIT.usage;
    }
    io.stderr(`Unexpected error: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    return EXIT.incomplete;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href.replace(/\/\/\/+/, "///");

if (isDirectRun || process.env.GATESEEKER_CLI === "1") {
  const code = await main(process.argv.slice(2), {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
  process.exitCode = code;
}

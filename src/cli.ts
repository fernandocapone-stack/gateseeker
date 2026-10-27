#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadAdvisories } from "./intel/advisories.js";
import { DEFAULT_PARSER_LIMITS } from "./parser/lockfile.js";
import { DEFAULT_WALK_LIMITS } from "./patterns/walker.js";
import { renderText } from "./report/text.js";
import { PRIORITIES } from "./rules/priority.js";
import { scan, scanDirectory, type ScanResult } from "./scan.js";
import { GATESEEKER_VERSION } from "./version.js";

/**
 * Exit codes (documented in README):
 *   0 pass        every query completed, nothing at or above --fail-on
 *   1 fail        at least one gated finding at or above --fail-on
 *   2 incomplete  at least one dependency query failed or was skipped; never 0
 *   3 usage       bad arguments, unreadable or rejected input
 */
export const EXIT = { pass: 0, fail: 1, incomplete: 2, usage: 3 } as const;

const USAGE = `gateseeker ${GATESEEKER_VERSION}

Usage: gateseeker scan <project-dir | package-lock.json> [options]

  A directory runs the code-pattern rules and, when package-lock.json exists at
  its root, the dependency analysis. A lockfile path runs dependencies only.

Options:
  --format <text|json>      Output format (default: text)
  --output <file>           Also write the JSON report to <file>
  --fail-on <P1|P2|P3|P4>   Priority threshold for a failing gate (default: P2)
  --only <deps|patterns>    Run a single analysis (directory scans only)
  --patterns <warn|gate>    warn: pattern findings are reported but do not
                            affect the verdict (default). gate: they do.
  --max-size <bytes>        Reject lockfiles larger than this (default: ${DEFAULT_PARSER_LIMITS.maxBytes})
  --max-deps <n>            Reject lockfiles with more packages than this (default: ${DEFAULT_PARSER_LIMITS.maxDependencies})
  --max-files <n>           Abort directory scans with more files (default: ${DEFAULT_WALK_LIMITS.maxFiles})
  --max-file-size <bytes>   Abort directory scans on a larger text file (default: ${DEFAULT_WALK_LIMITS.maxFileBytes})
  --advisories <file>       Use this curated advisory set (JSON) instead of the bundled one
  --timeout <ms>            Per-request timeout for the OSV API (default: 10000)
  --concurrency <n>         Maximum simultaneous OSV requests (default: 5)
  --help, -h                Show this help
  --version, -v             Show version

Exit codes: 0 pass, 1 fail, 2 incomplete, 3 usage or rejected input.
`;

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

class UsageError extends Error {}

function positiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--${name} must be a positive integer, got "${value}".`);
  return n;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], name: string, fallback: T): T {
  if (value === undefined) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new UsageError(`--${name} must be one of ${allowed.join(", ")}, got "${value}".`);
}

const optionSpec = {
  format: { type: "string" },
  output: { type: "string" },
  "fail-on": { type: "string" },
  only: { type: "string" },
  patterns: { type: "string" },
  "max-size": { type: "string" },
  "max-deps": { type: "string" },
  "max-files": { type: "string" },
  "max-file-size": { type: "string" },
  advisories: { type: "string" },
  timeout: { type: "string" },
  concurrency: { type: "string" },
  // Undocumented: lets tests point the client at a local server.
  "osv-endpoint": { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof optionSpec; allowPositionals: true }>>;
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
    io.stderr(`Expected: gateseeker scan <project-dir | package-lock.json>\n\n${USAGE}`);
    return EXIT.usage;
  }

  try {
    const format = oneOf(values.format, ["text", "json"] as const, "format", "text");
    const failOn = oneOf(values["fail-on"]?.toUpperCase(), PRIORITIES, "fail-on", "P2");
    const only = values.only === undefined ? undefined : oneOf(values.only, ["deps", "patterns"] as const, "only", "deps");
    const patternsMode = oneOf(values.patterns, ["warn", "gate"] as const, "patterns", "warn");
    const maxBytes = positiveInt(values["max-size"], "max-size");
    const maxDependencies = positiveInt(values["max-deps"], "max-deps");
    const maxFiles = positiveInt(values["max-files"], "max-files");
    const maxFileBytes = positiveInt(values["max-file-size"], "max-file-size");
    const timeoutMs = positiveInt(values.timeout, "timeout");
    const concurrency = positiveInt(values.concurrency, "concurrency");

    const targetPath = resolve(target);
    let targetStat;
    try {
      targetStat = await stat(targetPath);
    } catch (err) {
      throw new UsageError(`Cannot read ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
    }

    let advisories;
    if (values.advisories !== undefined) {
      advisories = await loadAdvisories({ path: resolve(values.advisories) });
      if (advisories.problems.length > 0) {
        throw new UsageError(`--advisories file rejected:\n  - ${advisories.problems.join("\n  - ")}`);
      }
    }

    const common = {
      failOn,
      patternsMode,
      ...(advisories !== undefined ? { advisories } : {}),
      limits: {
        ...(maxBytes !== undefined ? { maxBytes } : {}),
        ...(maxDependencies !== undefined ? { maxDependencies } : {}),
      },
      walkLimits: {
        ...(maxFiles !== undefined ? { maxFiles } : {}),
        ...(maxFileBytes !== undefined ? { maxFileBytes } : {}),
      },
      osv: {
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(concurrency !== undefined ? { concurrency } : {}),
        ...(values["osv-endpoint"] !== undefined ? { endpoint: values["osv-endpoint"] } : {}),
      },
    };

    let result: ScanResult;
    if (targetStat.isDirectory()) {
      result = await scanDirectory({ root: targetPath, ...common, ...(only !== undefined ? { only } : {}) });
    } else {
      if (only !== undefined) throw new UsageError("--only applies to directory scans; a lockfile path always runs the dependency analysis only.");
      const content = await readFile(targetPath, "utf8");
      result = await scan({ lockfilePath: targetPath, lockfileContent: content, ...common });
    }

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

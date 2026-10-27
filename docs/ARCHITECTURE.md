# Architecture (Sprint 0)

## Data flow

```
package-lock.json (text)
        │
        ▼
 src/parser/lockfile.ts      size limit → JSON.parse → version check → Zod schema → entries → unique Dependency[]
        │
        ▼
 src/intel/osv.ts            one POST /v1/query per unique name@version (concurrency-limited, memoised, timeout, pagination)
        │                    response → Zod schema → ok | failed
        ▼
 src/rules/                  cvss.ts (CVSS 3.x base score) → severity.ts (tier) → priority.ts (table) → findings.ts (Finding)
        │
        ▼
 src/scan.ts                 QueryRecord per dependency, Finding list, summary, verdict
        │
        ├──▶ src/report/text.ts   terminal rendering (sanitized)
        └──▶ JSON report          the Report type in src/types.ts, unchanged
        │
        ▼
 src/cli.ts                  arguments, file I/O, exit code
```

The only runtime dependency is Zod. HTTP uses Node's global `fetch`; argument parsing uses `node:util`'s `parseArgs`.

## Modules

| Module | Responsibility | Does not |
|---|---|---|
| `parser/lockfile.ts` | Parse and validate `package-lock.json` v2/v3; classify each entry's version status and exposure; collapse to unique `name@version`. | Read the file system, resolve ranges, verify integrity hashes, run npm. |
| `intel/osv-schema.ts` | Zod schema for the subset of the OSV record Gateseeker reads. Unknown fields pass through. | Reject records for unknown fields. |
| `intel/osv.ts` | Query OSV with timeout, concurrency limit, per-run memoisation, pagination cap, and explicit failure outcomes. | Interpret results, retry (a failure is surfaced, not hidden). |
| `rules/cvss.ts` | CVSS 3.0/3.1 base score from a vector string. | Score CVSS 2 or 4; temporal or environmental metrics. |
| `rules/severity.ts` | Severity tier: max CVSS 3.x score → tier; else declared qualitative rating; else UNKNOWN. | Guess a tier from free text. |
| `rules/priority.ts` | The priority table and modifiers. Returns priority plus the rule ids applied. | Anything beyond the table. |
| `rules/findings.ts` | Build a `Finding` from one dependency and one OSV record; extract fixed versions for that exact package; pick the smallest fix above the installed version. | Rewrite source text. |
| `scan.ts` | Orchestrate; produce `QueryRecord` per dependency; compute summary; decide verdict. | File or network I/O of its own (fetch is injectable). |
| `report/text.ts` | Human-readable output; strips control characters from every untrusted string. | Colour, interactivity. |
| `cli.ts` | Parse arguments, read the lockfile, write the report, map verdict to exit code. | Business logic. |

## Trust boundaries

1. **Lockfile → parser.** The lockfile is attacker-controlled. Controls: byte limit before parsing, dependency-count limit, strict schema, no code execution, names and versions treated as opaque strings until sanitized for display.
2. **OSV → client.** Responses are external data over TLS. Controls: schema validation (a malformed response is a failed query), timeout, pagination cap, summaries and references treated as untrusted text.
3. **Report → terminal / file.** Output includes attacker-influenced strings. Controls: `sanitize()` removes control characters and newlines, truncates long values. The JSON report is written with `JSON.stringify` and contains no interpolation.

## Query states and the verdict

Each unique dependency ends in exactly one state:

| State | Meaning |
|---|---|
| `vulnerable` | OSV returned at least one record. |
| `no-known-vulnerabilities` | OSV answered and returned none. |
| `query-failed` | HTTP error, network error, timeout, invalid JSON, schema mismatch, or pagination cap. |
| `not-queried` | Version missing, non-semver, or non-registry (git, file, tarball). |

Verdict rules, applied in order: any finding at or above `--fail-on` → `fail`; else any `query-failed` or `not-queried` → `incomplete`; else `pass`. See `decideVerdict` in `src/scan.ts`.

## Priority matrix

Documented in `README.md` and implemented as `BASE_PRIORITY` plus `MODIFIERS` in `src/rules/priority.ts`. `tests/priority.test.ts` asserts every cell against hard-coded expected values so a table change is a deliberate, visible diff in two places.

## Known limitations

- Only `package-lock.json` with `lockfileVersion` 2 or 3. v1, `yarn.lock`, `pnpm-lock.yaml`, `composer.lock` are rejected or not recognised.
- Only the `packages` section is read. The legacy `dependencies` block in v2 files is ignored.
- A dependency is "direct" when it is declared in the root entry's dependency maps **and** installed at top level. A nested copy of a directly declared package is treated as transitive.
- Workspace packages (paths outside `node_modules/`) and `link: true` entries are skipped with a warning.
- Dependencies whose version is missing, not strict semver, or resolved from a non-registry source are reported `not-queried`, which makes the run `incomplete`.
- `optional` and `peer` flags are recorded on entries but do not influence priority yet; exposure uses only `dev` and directness.
- OSV is the only intelligence source. A compromised package that kept its version number (tag rewrite, registry takeover with same version) is not detected. This is planned as `supply-chain-anomaly` in Sprint 2.
- CVSS 2 and CVSS 4 vectors are preserved in the report but not scored. If a record has only such vectors, the tier falls back to the declared rating or UNKNOWN.
- OSV's version match is a "fuzzy match against upstream versions" per its documentation; Gateseeker does not re-evaluate affected ranges locally.
- No reachability analysis: priority does not consider whether the vulnerable code path is used.
- No caching across runs; every scan queries OSV again.
- Integrity hashes in the lockfile are not verified.

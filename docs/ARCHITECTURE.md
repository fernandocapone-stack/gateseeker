# Architecture (after Sprint 2a)

## Data flow

```
project directory ──▶ src/patterns/walker.ts ──▶ ProjectSnapshot ──▶ src/patterns/engine.ts ──▶ Finding[] (insecure-pattern)
        │                (limits, ignores,         (files + class)        (rules, suppressions)
        │                 binary probe)
        └── package-lock.json (if present at root)
                  │
                  ▼
        src/parser/lockfile.ts ──▶ Dependency[] ──▶ src/intel/osv.ts ──▶ src/rules/{cvss,severity,findings}.ts ──▶ Finding[] (dependency-vulnerability)
                                      │
                                      └──▶ src/intel/advisories.ts (approved records, local match) ──▶ Finding[] (supply-chain-anomaly)
                                                                                             │
                                             both ──▶ src/rules/priority.ts (one table) ◀────┘
                                                              │
                                                              ▼
                                                   src/scan.ts (assemble, verdict)
                                                              │
                                              ┌───────────────┴──────────────┐
                                              ▼                              ▼
                                     src/report/text.ts                  JSON Report
                                              │                              │
                                              └──────────── src/cli.ts ──────┘  (arguments, exit code)
```

The only runtime dependency is Zod. HTTP uses Node's global `fetch`; argument parsing uses `node:util`'s `parseArgs`; the file walk uses `node:fs/promises`.

## Modules

| Module | Responsibility | Does not |
|---|---|---|
| `parser/lockfile.ts` | Parse and validate `package-lock.json` v2/v3; classify each entry's version status and exposure; collapse to unique `name@version`; compare semver. | Read the file system, resolve ranges, verify integrity hashes, run npm. |
| `intel/osv-schema.ts` | Zod schema for the subset of the OSV record Gateseeker reads. Unknown fields pass through. | Reject records for unknown fields. |
| `intel/osv.ts` | Query OSV with timeout, concurrency limit, per-run memoisation, pagination cap, and explicit failure outcomes. | Interpret results, retry. |
| `intel/advisory-schema.ts` | Zod schema for curated advisory records: status rules, two-publisher requirement for `approved`, semver checks for npm, text limits, credential-pattern rejection. | Fetch anything. |
| `intel/advisories.ts` | Load the advisory set (explicit path, bundled `dist/advisories.json`, or checkout directory), keep `approved` only, match npm dependencies by exact version or range, build `supply-chain-anomaly` findings. | Download at runtime, match non-npm ecosystems (until the Composer parser exists). |
| `intel/feed/rss.ts` | Minimal RSS/Atom parser: refuses DOCTYPE/ENTITY, bounded regexes, keeps title/link/date only. | General XML. |
| `intel/feed/collect.ts` | Fetch configured feeds through an injected `fetch` (https only, size and time limits, no cross-host redirects), filter by keywords, extract package candidates lexically, deduplicate against committed state, write `proposed` records. | Decide anything; call a model. |
| `intel-cli.ts` | `gateseeker-intel collect / validate / build` for maintainers and the scheduled workflow. | Run during a user's scan. |
| `rules/cvss.ts` | CVSS 3.0/3.1 base score from a vector string. | Score CVSS 2 or 4. |
| `rules/severity.ts` | Severity tier: max CVSS 3.x score → tier; else declared rating; else UNKNOWN. | Guess from free text. |
| `rules/priority.ts` | The priority table and modifiers, shared by both finding kinds. Returns priority plus rule ids applied. | Anything beyond the table. |
| `rules/findings.ts` | Build a dependency `Finding` from one OSV record; extract fixed versions for that exact package; pick the smallest fix above the installed version. | Rewrite source text. |
| `patterns/walker.ts` | Walk a directory into a `ProjectSnapshot` under limits; skip symlinks, fixed directories, `.gitignore` matches, binaries; keep `.env*` and `.gitignore` even when gitignored. | Follow links, leave the root, run git. |
| `patterns/gitignore.ts` | Minimal `.gitignore` matcher (no negation, root file only). | Full git semantics. |
| `patterns/classify.ts` | Assign `client`/`server`/`config`/`sql`/`env`/`rules`/`test`/`other` by path and `"use client"` directive; detect Next vs Vite. | Parse code. |
| `patterns/rules/*.ts` | One file per rule: `appliesTo(file)` and `check(ctx)` returning line-level matches with redacted snippets. | Mutate state, read outside the snapshot. |
| `patterns/engine.ts` | Run rules, apply `gateseeker-ignore` suppressions, convert matches to `Finding`s through the shared priority table, isolate rule errors. | Decide the verdict. |
| `patterns/redact.ts` | Secret redaction (first 4 chars + length), dotenv value hiding, entropy, placeholder detection. | Store values. |
| `scan.ts` | Orchestrate `scan()` (lockfile only) and `scanDirectory()` (patterns + optional deps); produce `QueryRecord`s, summary, verdict. | File or network I/O of its own beyond reading the root lockfile. |
| `report/text.ts` | Human-readable output; strips control characters from every untrusted string. | Colour, interactivity. |
| `cli.ts` | Arguments, path type detection, report writing, exit code. | Business logic. |

## Curated advisory flow

```
public feeds ──(Intel feed workflow, every 6 h)──▶ advisories/proposed/*.json ──(human review in PR)──▶ advisories/approved/*.json
                                                                                                              │
                                                                             pnpm build: gateseeker-intel build ▼
                                                                                                   dist/advisories.json ──▶ gateseeker scan
```

The workflow is the only one with write permissions and uses the repository's own token. CI validates every record on every push. The scanner never reads `proposed` or `rejected` records.

## Trust boundaries

1. **Project files → walker and rules.** Everything in the directory is attacker-controlled. Controls: symlinks skipped; containment check on every path; fixed directory exclusions; file-count, file-size and depth limits that abort with a typed error (exit 3); binary detection by extension and NUL probe; lines over 5000 characters skipped by rules; regexes reviewed and timed against adversarial 1 MB inputs; snippets sanitized and secrets redacted; rule exceptions caught and reported as a `GSK-ENGINE-000` finding instead of crashing.
2. **Lockfile → parser.** Byte limit before parsing, dependency-count limit, strict schema, no code execution.
3. **OSV → client.** Schema validation (malformed response is a failed query), timeout, pagination cap, summaries and references treated as untrusted text.
4. **Public feeds → collector.** Feed bodies are attacker-influenceable text. Controls: allow-listed `https` sources only, 2 MB and 10 s limits, no cross-host redirects, parser refuses DOCTYPE/ENTITY, only title/link/date retained, titles sanitized, output is a `proposed` record that a human must act on.
5. **Advisory records → scanner.** Records are data in the repository, reviewed in PRs and validated by schema in CI and at load time; credential-looking tokens are rejected; only `approved` records match.
6. **Report → terminal / file.** `sanitize()` removes control characters and newlines, truncates long values. Secrets never appear in full in any output; tests assert this for the JSON report and the terminal text.

## Query states and the verdict

Each unique dependency ends in exactly one state: `vulnerable`, `no-known-vulnerabilities`, `query-failed`, `not-queried`.

Verdict rules, applied in order (`decideVerdict` in `src/scan.ts`):

1. Any **gated** finding at or above `--fail-on` → `fail`. Dependency findings are always gated; pattern findings only with `--patterns gate`.
2. Otherwise any `query-failed` or `not-queried` dependency → `incomplete`.
3. Otherwise `pass`, with a reason that states which analyses ran.

A directory without `package-lock.json` yields `analyses.dependencies = "not-analyzed"`; this is declared in `limitations` and does not make the run `incomplete`.

## File classification heuristics

Applied in order; the first match wins.

| Class | Rule |
|---|---|
| `test` | Any path segment in `__tests__`, `__mocks__`, `test`, `tests`, `spec`, `specs`, `e2e`, `fixtures`, `cypress`, `playwright`, `stories`; or basename matches `*.test.*`, `*.spec.*`, `*.stories.*`. |
| `env` | Basename `.env` or `.env.*`. |
| `sql` | Extension `.sql`. |
| `rules` | `firestore.rules`, `storage.rules`, `database.rules.json`. |
| `config` | `<tool>.config.*` for known tools, `vercel.json`, `netlify.toml`, `package.json`, `firebase.json`, `tsconfig*.json`, `.gitignore`. |
| `server` | Code files under `pages/api/`, `app/**/route.*`, `middleware.*`, `supabase/functions/`, `*.server.*`, `lib/server/`, or any segment in `api`, `server`, `backend`, `functions`, `scripts`, `workers`, `netlify`, `lambda`, `jobs`, `cron`. |
| `client` | Code files starting with a `"use client"` directive; everything under `src/` in a Vite project; `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`; or any segment in `components`, `hooks`, `pages`, `app`, `views`, `ui`, `public`, `layouts`, `store(s)`, `features`. |
| `other` | Everything else (including non-code files). |

Project kind: `next` if a `next.config.*` exists at the root, `vite` if a `vite.config.*` exists, else `unknown`.

## Priority matrix

Documented in `README.md` and implemented as `BASE_PRIORITY` plus `MODIFIERS` in `src/rules/priority.ts`. `tests/priority.test.ts` asserts every cell against hard-coded expected values. Pattern findings enter the same table with exposure `direct-prod` (or `dev-only` for `test` files) and `fixAvailable: true`; their rationale starts with `rule:<id>`.

## Known limitations

Dependencies:

- Only `package-lock.json` with `lockfileVersion` 2 or 3. Only the `packages` section is read.
- A dependency is "direct" when declared in the root entry **and** installed at top level; nested copies of direct packages are treated as transitive.
- Workspace packages and `link: true` entries are skipped with a warning. Missing, non-semver or non-registry versions are `not-queried`, which makes the run `incomplete`.
- Intelligence comes from OSV plus the curated advisory set; an incident absent from both is not detected. The curated set covers what a reviewer approved; Packagist records do not match until the Composer parser exists (Sprint 2b); structural supply-chain heuristics are also Sprint 2b.
- CVSS 2 and 4 vectors are preserved but not scored. OSV's version matching is performed server-side. No reachability analysis. No cross-run cache. Integrity hashes are not verified.

Code patterns:

- Rules are lexical/structural; they do not follow data flow and cannot find injection, missing authorization in general, or logic flaws.
- Classification is heuristic. A server file placed in an unconventional path may be classified `client` or `other`, producing or hiding a finding; the class is recorded on each finding for that reason.
- The `.gitignore` matcher ignores negations and nested `.gitignore` files. Gateseeker never runs git, so "likely committed" must be confirmed by the user.
- Secret detection covers only provider formats with unambiguous prefixes. Generic high-entropy strings and Google `AIza` keys are not reported.
- `GSK-SUPABASE-001` understands `create table` / `alter table ... row level security` in migration files; tables created through other tooling or SQL run outside migrations are invisible to it. Migration order is file-path order.
- `GSK-CORS-001` reads header literals and `cors()` calls; CORS configured through variables or platform dashboards is not seen. Without credentials in the same file the finding is LOW: validation on real projects showed the Supabase Edge Function template ships a wildcard header, and a wildcard without cookies mostly exposes what a bearer-token API exposes anyway.
- `GSK-SECRET-002` cannot see hardcoded fallback values (`process.env.X || 'literal'`); it masks them in the snippet but does not report the literal itself, because generic literal detection is out of scope.
- A wildcard-origin suppression covers its own line and the next one only.
- Rules were validated on synthetic fixtures; validation on real projects is tracked in `docs/VALIDATION_SPRINT_1.md` and rules below the precision bar are marked experimental there.

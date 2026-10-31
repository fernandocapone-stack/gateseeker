# Architecture (after Sprint 4)

## Data flow

```
project directory ──▶ src/patterns/walker.ts ──▶ ProjectSnapshot ──▶ src/patterns/engine.ts ──▶ Finding[] (insecure-pattern)
        │                (limits, ignores,         (files + class)        (rules, suppressions)
        │                 binary probe)
        └── package-lock.json (if present at root)
                  │
                  ▼
        src/parser/{lockfile,pnpm,yarn}.ts (npm) or src/parser/composer.ts ──▶ Dependency[] ──▶ src/intel/osv.ts ──▶ src/rules/{cvss,severity,findings}.ts ──▶ Finding[] (dependency-vulnerability)
                                      │
                                      ├──▶ src/intel/advisories.ts (approved records; versions/ranges locally, tag rewrites via src/intel/packagist.ts) ──▶ Finding[] (supply-chain-anomaly, origin advisory)
                                      │
                                      └──▶ src/supplychain/{snapshot,rules}.ts (current lock vs optional --baseline) ──▶ Finding[] (supply-chain-anomaly, origin structural)
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
| `parser/yaml-subset.ts` | The YAML subset pnpm and Yarn Berry lockfiles use: block maps by indentation, scalar sequences, quoted scalars, flow collections kept as text, several documents; capped and prototype-safe. | Anchors, aliases, tags, type coercion, evaluation. |
| `parser/pnpm.ts` | `pnpm-lock.yaml` v9: project document only (pnpm 11+ adds the package manager's own), importers for direct/dev, snapshots for production reachability, packages for versions and integrity; peer suffixes and aliases handled. | Run pnpm, read v6-v8 lockfiles. |
| `parser/yarn.ts` | `yarn.lock` Yarn 1 (own line format) and Berry (YAML): entries by spec, workspace and patch entries handled, root `package.json` for direct/dev, production by reachability. | Run Yarn, read Plug'n'Play data. |
| `parser/js-lock.ts` | Shared result type, manifest reading and reachability for the pnpm and Yarn readers; both emit the same entries as `lockfile.ts`. | Anything format-specific. |
| `parser/composer.ts` | Parse and validate Composer 2 `composer.lock` (+ optional `composer.json` for directness); normalize `vX.Y.Z`; classify `dev-*`, aliases and path/non-registry sources; keep commit, source URL, release time, autoload files and scripts per entry. | Run composer, resolve constraints. |
| `intel/packagist.ts` | Read-only Packagist p2 metadata client (https, no token, timeout, memoised): expands the delta-encoded version list and answers which commit a version currently points at. | Write anything, query other hosts. |
| `supplychain/snapshot.ts` | Ecosystem-neutral view of a lockfile (reference, host, install scripts, autoload files, release time, dev/direct). | Interpret. |
| `supplychain/rules.ts` | GSK-SC-001..005 over one snapshot and an optional baseline; baseline diff summary. | Network. |
| `intel/advisory-schema.ts` | Zod schema for curated advisory records: status rules, two-publisher requirement for `approved`, semver checks for npm, text limits, credential-pattern rejection. | Fetch anything. |
| `intel/advisories.ts` | Load the advisory set (explicit path, bundled `dist/advisories.json`, or checkout directory), keep `approved` only, match npm dependencies by exact version or range, build `supply-chain-anomaly` findings. | Download at runtime, match non-npm ecosystems (until the Composer parser exists). |
| `intel/feed/rss.ts` | Minimal RSS/Atom parser: refuses DOCTYPE/ENTITY, bounded regexes, keeps title/link/date only. | General XML. |
| `intel/feed/collect.ts` | Fetch configured feeds through an injected `fetch` (https only, size and time limits, no cross-host redirects), filter by keywords, extract package candidates lexically, deduplicate against committed state, write `proposed` records. | Decide anything; call a model. |
| `intel/feed-signature.ts` | HMAC-SHA256 signature of a published advisory set (publication time, digest, exact payload); constant-time check. | Store keys or talk to the network. |
| `intel-cli.ts` | `gateseeker-intel collect / validate / build / ui / publish-feed` for maintainers and the scheduled workflows. | Run during a user's scan. |
| `intel/ui/server.ts` | Local triage server (127.0.0.1, per-session token): serves `ui/dist`, lists records, applies approve/reject/save with schema validation, reviewer stamping, file moves and one commit per decision; optional merge of the newest `origin/intel/*` branch at start. | Listen on other interfaces, accept requests without the token, edit approved records. |
| `intel/ui/git.ts` | Allowlisted git runner: `add`, `commit`, `push`, `fetch`, `merge --no-edit`, read-only `config`/`rev-parse`/`rev-list`/`branch`/`log`/`status`; forbids force, hard, delete, amend, no-verify. | Any other git command. |
| `ui/` (separate package) | React + Vite + Tailwind interface with shadcn-style components: pending list, review form in plain language with the source beside it, history, push. | Talk to anything but the local API. |
| `rules/cvss.ts` | CVSS 3.0/3.1 base score from a vector string. | Score CVSS 2 or 4. |
| `rules/severity.ts` | Severity tier: max CVSS 3.x score → tier; else declared rating; else UNKNOWN. | Guess from free text. |
| `rules/priority.ts` | The priority table and modifiers, shared by both finding kinds. Returns priority plus rule ids applied. | Anything beyond the table. |
| `rules/remediation/*.ts` | Fix guidance as rule conclusions: `impact`, `manualSteps` and `aiPrompt` per pattern rule (`patterns.ts`), for dependency updates and supply-chain findings (`dependencies.ts`); every interpolated value passes an allowlist (`safe.ts`). | Quote file contents, call a model, suggest suppressing the finding. |
| `rules/findings.ts` | Build a dependency `Finding` from one OSV record; extract fixed versions for that exact package; pick the smallest fix above the installed version. | Rewrite source text. |
| `patterns/walker.ts` | Walk a directory into a `ProjectSnapshot` under limits; skip symlinks, fixed directories, `.gitignore` matches, binaries; keep `.env*` and `.gitignore` even when gitignored. | Follow links, leave the root, run git. |
| `patterns/gitignore.ts` | Minimal `.gitignore` matcher (no negation, root file only). | Full git semantics. |
| `patterns/classify.ts` | Assign `client`/`server`/`config`/`sql`/`env`/`rules`/`agent`/`test`/`other` by path and `"use client"` directive; detect Next vs Vite. | Parse code. |
| `patterns/rules/*.ts` | One file per rule: `appliesTo(file)` and `check(ctx)` returning line-level matches with redacted snippets. | Mutate state, read outside the snapshot. |
| `patterns/engine.ts` | Run rules, apply `gateseeker-ignore` suppressions, convert matches to `Finding`s through the shared priority table, isolate rule errors. | Decide the verdict. |
| `patterns/redact.ts` | Secret redaction (first 4 chars + length), dotenv value hiding, entropy, placeholder detection. | Store values. |
| `scan.ts` | Orchestrate `scan()` (lockfile only) and `scanDirectory()` (patterns + optional deps); produce `QueryRecord`s, summary, verdict. | File or network I/O of its own beyond reading the root lockfile. |
| `report/text.ts` | Human-readable output; strips control characters from every untrusted string. | Colour, interactivity. |
| `report/sarif.ts` | SARIF 2.1.0: one result per finding, levels by priority, stable fingerprints, file:line for patterns and the lockfile for the rest. | Upload (the Action does that). |
| `report/pdf.ts` | PDF 1.4 writer for the report (standard fonts, WinAnsi, word wrap, pagination), browser- and Node-safe; behind the page's "Download PDF". | Embed fonts, draw links or actions, add data the JSON lacks. |
| `report/compare.ts` | Compares two reports of one repository: new, still open, fixed, and unverified (gone, but the newer scan could not have checked it). Keys never use line numbers; snippets enter only as a hash. Browser- and Node-safe. | Decide priorities, read files. |
| `report/summary.ts` | Markdown for the job summary and the sticky PR comment; untrusted strings escaped, table capped at 20 rows. | Links built from project data. |
| `action/run.ts`, `action/github.ts`, `action-cli.ts` | The GitHub Action runner: reads `INPUT_*`, fetches the baseline lockfile from the base branch with `git show` (the only git call in the product, inside the user's workflow), runs `scanDirectory`, writes report/SARIF/summary/outputs, upserts the sticky comment, maps the verdict to the exit code. | Anything the CLI does not. |
| `action.yml` | Composite action: setup-node, pinned `npx --package=gateseeker@<version> gateseeker-action` (or a local build for this repository), base-branch fetch, SARIF upload. | Third-party actions beyond checkout/setup-node/codeql upload. |
| `cli.ts` | Arguments, path type detection, report writing, exit code. | Business logic. |
| `web/github-url.ts` | Strict grammar for `https://github.com/<owner>/<repo>[/tree/<ref>]`; rejects before any request. | Parse general URLs, accept other hosts. |
| `web/tar.ts` | Dependency-free `.tar.gz` reader with limits; writes regular files and directories only, skips and lists links; strips GitHub's top-level folder. | Follow links, write outside the destination. |
| `web/service.ts` | Resolve the repository and commit on the GitHub API, download the archive, extract, run `scanDirectory`, clean up; injected `fetch`. | git, child processes, tokens (optional read-only `GITHUB_TOKEN` only for the API limit). |
| `web/auth.ts` | Verify the bearer token with Supabase Auth; static and stub verifiers for tests. | Pass the user to the engine. |
| `web/store.ts` | Saved reports (30 days), per-user quota (`claim_scan`), per-commit cache, scan history (180 days, `scans`), followed repositories (`follows`, limit enforced by `follow_repo`); memory and Supabase (PostgREST, service key) implementations. | Interpret report content. |
| `web/handler.ts` | Framework-agnostic handlers: auth → quota → cache → scan → save; report read by owner; cleanup and daily monitor with `CRON_SECRET`; follows; `POST /api/feed/published` (signed set → store → queue → rescan); picks the advisory set for each scan (latest published set when its signature and digest check out, else the bundled one). | Know about Vercel or Node HTTP. |
| `web/env.ts`, `web/local-server.ts` | Build handler options from environment variables (fail closed when auth is required and missing); local server for development and e2e. | Log keys. |
| `web/` (separate package) and `web/api/` | Public site and workspace (React + Vite, `@supabase/supabase-js` for sign-in only); Vercel functions are thin wrappers around `src/web/handler.ts`. | Reimplement rules, priorities or texts; talk to Supabase tables. |
| `ui-kit/` (separate package) | Theme tokens and components shared by `ui/` and `web/`. | Business logic. |

## Curated advisory flow

```
public feeds ──(Intel feed workflow, every 6 h)──▶ advisories/proposed/*.json ──(human review in PR)──▶ advisories/approved/*.json
                                                                                                              │
                                                                             pnpm build: gateseeker-intel build ▼
                                                                                                   dist/advisories.json ──▶ gateseeker scan
```

The workflow is the only one with write permissions and uses the repository's own token. CI validates every record on every push. The scanner never reads `proposed` or `rejected` records.

## Hosted service flow (Sprint 4)

```
browser (/app, signed in with GitHub via Supabase Auth)
   │  POST /api/scan { url }  + bearer token
   ▼
web/api/scan.ts ──▶ src/web/handler.ts
                      1. auth     src/web/auth.ts      (401 without a valid session)
                      2. quota    src/web/store.ts     (claim_scan, 429 when exhausted, before any download)
                      3. cache    same commit within 24 h ──▶ reuse the saved report
                      4. scan     src/web/service.ts ──▶ github-url.ts ──▶ GitHub API (repo, commit)
                                                     ──▶ codeload .tar.gz ──▶ tar.ts (/tmp, limits)
                                                     ──▶ scanDirectory (same engine as the CLI) ──▶ Report
                      5. save     src/web/store.ts     (Supabase reports, 30 days) ──▶ { id, report }
   ◀── JSON; GET /api/reports/<id> returns it to its owner only; Vercel Cron purges expired rows daily
```

The engine is the published package at the pinned version; the web adds no rule, priority or wording of its own.

## Trust boundaries

1. **Project files → walker and rules.** Everything in the directory is attacker-controlled. Controls: symlinks skipped; containment check on every path; fixed directory exclusions; file-count and depth limits that abort with a typed error (exit 3) and a per-file size limit above which a file is skipped unread and listed in the limitations; binary detection by extension and NUL probe; lines over 5000 characters skipped by rules; regexes reviewed and timed against adversarial 1 MB inputs; snippets sanitized and secrets redacted; rule exceptions caught and reported as a `GSK-ENGINE-000` finding instead of crashing.
2. **Lockfile → parser.** Byte limit before parsing, dependency-count limit, strict schema, no code execution. YAML lockfiles go through a prototype-safe subset reader with depth and entry caps before the schema.
3. **OSV → client.** Schema validation (malformed response is a failed query), timeout, pagination cap, summaries and references treated as untrusted text.
4. **Registry metadata → scanner.** Packagist p2 responses are validated by schema; a failed or missing lookup never clears a dependency: the tag match falls back to the time check, is marked unverified, and the Packagist query is recorded as failed, which makes the verdict `incomplete`.
5. **Baseline lockfile → structural rules.** The baseline is user-supplied and could itself be tampered with; the report prints both lockfile hashes and the diff summary so the comparison is auditable. Rules only compare fields; nothing is fetched or executed.
6. **Public feeds → collector.** Feed bodies are attacker-influenceable text. Controls: allow-listed `https` sources only, 2 MB and 10 s limits, no cross-host redirects, parser refuses DOCTYPE/ENTITY, only title/link/date retained, titles sanitized, output is a `proposed` record that a human must act on.
7. **Advisory records → scanner.** Records are data in the repository, reviewed in PRs and validated by schema in CI and at load time; credential-looking tokens are rejected; only `approved` records match.
8. **Browser → triage server.** Only 127.0.0.1; every API call needs the session token printed by the CLI (the page strips it from the address bar); CSP and nosniff headers; static files are confined to `ui/dist`; request bodies capped at 512 KB; the record id in a decision is taken from the server-side pending record, not from the client; approve/reject refuse to run when git has no `user.name`.
9. **User workflow → Action.** Inputs are untrusted strings: enumerations are validated, numbers parsed, paths resolved under the workspace; the baseline is read with `git show` of a ref the user named and written into the output directory; the comment body is Markdown-escaped; failures to comment or upload never change the verdict.
11. **Internet → hosted service.** Only signed-in users can scan; the URL grammar is checked before any request; the archive is extracted by our own reader under hard limits; nothing is executed; quota is claimed before downloading; the store is reachable only with the service key (RLS on, no policies) and returns a report only to its owner; the page renders report content as text under a strict CSP. Details in `docs/THREAT_MODEL.md` §11.
10. **Report → terminal / file.** `sanitize()` removes control characters and newlines, truncates long values. Secrets never appear in full in any output; tests assert this for the JSON report and the terminal text.

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
| `agent` | AI coding-agent files: top-level `.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.windsurf/`, `.roo/`, `.kiro/`; `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.mcp.json` anywhere; `.github/copilot-instructions.md`, `.vscode/mcp.json`. |
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
- Intelligence comes from OSV plus the curated advisory set; an incident absent from both is not detected. Tag-rewrite matching needs the lock's `source.reference` and `time`; locks without them (or `--no-packagist`) yield unverified results.
- Structural rules compare only what two lockfiles say; without `--baseline` only GSK-SC-001 and GSK-SC-004 run. A package appearing with several versions (npm nested copies) is skipped by the pairwise rules. Composer `composer.json` is optional; without it no dependency is "direct" and priorities are one step lower.
- Composer versions with four components or `dev-*` branches are not queried against OSV.
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

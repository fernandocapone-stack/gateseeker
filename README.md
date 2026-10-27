# Gateseeker

Security gate for AI-generated code. *(working description; branding and tagline are pending)*

Gateseeker points at a project directory, checks the code for the security mistakes most common in AI-generated apps, asks [OSV](https://osv.dev) which installed npm versions have known vulnerabilities, ranks every finding with deterministic and auditable rules, and returns a gate verdict with an exit code you can wire into CI.

**Status after Sprint 2a:** npm lockfiles (v2/v3) checked against OSV **and** a curated, human-approved advisory feed for supply-chain incidents the databases miss; eight code-pattern rules for JavaScript/TypeScript projects (Next.js, Vite, Supabase, Firebase). CLI only. See [docs/PRODUCT.md](docs/PRODUCT.md) for direction and `docs/SPRINT_*.md` for the scope this code implements.

## Requirements

- Node.js 24 or later
- pnpm 12 (the repository pins `packageManager`; `corepack enable` or `npm install -g pnpm`)

## Install and run from source

```bash
pnpm install
```

```bash
pnpm build
```

```bash
node dist/cli.js scan ./path/to/project
```

During development you can skip the build:

```bash
pnpm dev scan fixtures/projects/vibe-next-supabase
```

## Usage

```
gateseeker scan <project-dir | package-lock.json> [options]

  A directory runs the code-pattern rules and, when package-lock.json exists at
  its root, the dependency analysis. A lockfile path runs dependencies only.

  --format <text|json>      Output format (default: text)
  --output <file>           Also write the JSON report to <file>
  --fail-on <P1|P2|P3|P4>   Priority threshold for a failing gate (default: P2)
  --only <deps|patterns>    Run a single analysis (directory scans only)
  --patterns <warn|gate>    warn: pattern findings are reported but do not
                            affect the verdict (default). gate: they do.
  --max-size <bytes>        Reject lockfiles larger than this (default: 5242880)
  --max-deps <n>            Reject lockfiles with more packages than this (default: 5000)
  --max-files <n>           Abort directory scans with more files (default: 5000)
  --max-file-size <bytes>   Abort directory scans on a larger text file (default: 1048576)
  --advisories <file>       Use this curated advisory set (JSON) instead of the bundled one
  --timeout <ms>            Per-request timeout for the OSV API (default: 10000)
  --concurrency <n>         Maximum simultaneous OSV requests (default: 5)
```

### Exit codes

| Code | Verdict | Meaning |
|---|---|---|
| `0` | `pass` | Every dependency was queried and no gated finding reached the `--fail-on` threshold. |
| `1` | `fail` | At least one gated finding at or above the threshold. |
| `2` | `incomplete` | At least one dependency query failed or a dependency could not be queried. **Never** reported as `0`, regardless of findings. |
| `3` | usage | Bad arguments, unreadable path, lockfile rejected (malformed, unsupported version, over limits), or directory over the walker limits. |

`fail` takes precedence over `incomplete`. In the default `--patterns warn` mode, code-pattern findings appear in the report with their priority but do not change the verdict; use `--patterns gate` once you have reviewed them.

A directory without `package-lock.json` has its dependencies declared `not-analyzed` in the report; that is not `incomplete`, because no query failed.

### Example output

Produced against `fixtures/projects/vibe-next-supabase` with `--only patterns` (counts may differ slightly as fixtures evolve):

```
gateseeker 0.1.0  run 1a05db4a-baa8-4391-a94e-9409000159af
project        .../fixtures/projects/vibe-next-supabase
dependencies   not analyzed (no package-lock.json at root, or --only patterns)
code           20 files scanned, 1 ignored, 1 binary; 8 rules; mode warn
sources        gateseeker-rules

Findings: 18  (P1 13, P2 3, P3 2, P4 0)  dependencies 0, code patterns 18
  [P1] .env:2  GSK-SECRET-001  Credential with a known provider format is hardcoded
       Hardcoded credential of type "supabase-service-role-jwt" (219 characters).
       code:     SUPABASE_SERVICE_ROLE_KEY=eyJh…[219 chars]
       severity: CRITICAL (env file)   why: rule:GSK-SECRET-001, base:critical/direct-prod=P1, fix-available
       action:   Revoke the credential at the provider, move it to a server-side environment variable or secret manager, and purge it from git history.
  ...

GATE: PASS (fail-on P2, patterns warn)
  Code patterns were analyzed in warn mode (not gated); no finding at priority P2 or higher. ...
```

Secrets are never printed: a matched credential is shown as its first four characters and its length.

## Curated advisory feed

Official vulnerability databases miss a class of incident: a package whose existing tags or versions are rewritten with malicious code, with no new version number and no CVE. Five months after the Laravel-Lang Composer compromise of May 2026, OSV still had no record of it. Gateseeker keeps its own curated set of such incidents under [advisories/](advisories/README.md):

- A scheduled workflow (`Intel feed`, every 6 hours) reads public security feeds, keeps entries that look like supply-chain incidents, and opens a pull request with proposed records. It stores only titles, links and dates, never the text of a source.
- A named reviewer completes each record and marks it `approved` or `rejected`. Nothing is merged or consumed automatically.
- `pnpm build` compiles `advisories/approved/` into `dist/advisories.json`; `gateseeker scan` matches every npm dependency against it and reports hits as `supply-chain-anomaly` findings with the record's severity, sources and reviewer. Packagist records are stored and validated; they will match once the `composer.lock` parser lands (Sprint 2b).
- Approved records are offered upstream to OSV/GHSA following [docs/UPSTREAM.md](docs/UPSTREAM.md). Advisory data is CC-BY-4.0.

Maintainer commands: `gateseeker-intel collect | validate | build | ui`.

### Reviewing proposals without touching JSON

```bash
pnpm build
```

```bash
node dist/intel-cli.js ui
```

opens a local triage interface in the browser (127.0.0.1 only, with a per-session token in the address). It merges the newest open `intel/*` branch into the current one, lists pending proposals in plain language, shows the original source beside the form, and offers **Aprovar**, **Rejeitar com motivo** and **Deixar para depois**. Each decision validates the record against the schema, records the git user as reviewer, moves the file to `advisories/approved/` or `advisories/rejected/`, and makes one local commit; **Enviar para o GitHub** pushes when the batch is done. Approving requires two sources from distinct publishers or one primary source, exactly like the CI check. Engineering can pre-fill a `draft` block that the reviewer confirms field by field; drafts are never read by the scanner and are removed on decision.

The interface lives in `ui/` (Vite, React, Tailwind, shadcn-style components) and is served by the `gateseeker-intel ui` command from `src/intel/ui/`. It only runs `git add`, `commit`, `push`, `fetch` and `merge --no-edit`; everything else is refused.

## Code-pattern rules

Rules are lexical and structural checks on text files. They never execute project code and never follow data flow. Each one ships with positive and negative fixtures in `fixtures/projects/`.

| Id | Detects | Severity |
|---|---|---|
| `GSK-SECRET-001` | Credential with a known provider format hardcoded: AWS access key, Stripe live key, GitHub token, OpenAI and Anthropic keys, Slack token, PEM private key, Supabase `service_role` JWT. Skips tests, `.env.example`, docs, placeholders and low-entropy tokens. | CRITICAL |
| `GSK-SECRET-002` | Variable with a client-bundle prefix (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`, `NUXT_PUBLIC_`, `PUBLIC_`) named like a secret. Known public names (`ANON_KEY`, `PUBLISHABLE`, `CLIENT_ID`, Mapbox `pk.` tokens, ...) are allowed. | CRITICAL |
| `GSK-SUPABASE-001` | Table created in `supabase/` migrations without any `enable row level security`, or disabled in a later migration. Unexposed schemas (`auth`, `storage`, ...) are skipped. | HIGH |
| `GSK-SUPABASE-002` | Client-side file references a `SERVICE_ROLE` environment variable. | CRITICAL |
| `GSK-FIREBASE-001` | Firestore/Storage rule with `if true`, or Realtime Database `".read"`/`".write": true`. | HIGH (MODERATE if read-only) |
| `GSK-CORS-001` | `Access-Control-Allow-Origin: *` in headers or config, `cors({ origin: "*" })`, or default `cors()`. | LOW (HIGH when the same file enables credentials; without credentials a wildcard is informational, and the Supabase Edge Function template ships it by default) |
| `GSK-ENV-001` | Root `.env*` file with non-public variables not covered by `.gitignore`. | MODERATE |
| `GSK-BUILD-001` | `next.config` with `ignoreBuildErrors` or `ignoreDuringBuilds` set to true. | LOW |

Code snippets in findings never carry hardcoded values: matched credentials are shown as their first four characters and length, dotenv values are hidden, and quoted string literals of eight or more characters next to a flagged variable are masked.

Google `AIza...` keys are intentionally not detected: Firebase web API keys use that format and are public by design, so the pattern alone cannot separate a secret from a public key.

### Suppressing a finding

Put a comment on the same line or the line above, with a mandatory reason:

```ts
res.headers.set("Access-Control-Allow-Origin", "*"); // gateseeker-ignore GSK-CORS-001 public webhook, no cookies
```

Suppressions are listed in the report with file, line, rule and reason. A suppression without a reason is ignored and reported as a warning.

### File classification

Rules apply to classes of files: `client`, `server`, `config`, `sql`, `env`, `rules`, `test`, `other`. Classification is by path convention (`app/**/route.ts` and `pages/api/**` are server; `"use client"` files, `components/`, `.tsx` and everything under `src/` in Vite projects are client; `__tests__/`, `*.test.*` are test) and is recorded on every finding. Test files lower the exposure to dev-only, which lowers priority.

## How priority is decided

Priority is a function of three facts, looked up in a single table in [src/rules/priority.ts](src/rules/priority.ts):

1. **Severity tier.** For dependencies: computed from the CVSS 3.x vector published by the source, else the source's qualitative rating, else `UNKNOWN` (treated like `MODERATE`). For code patterns: the rule's intrinsic severity, sometimes adjusted by the match (for example CORS with credentials).
2. **Exposure**: direct production dependency, transitive production dependency, or dev-only. Project code counts as direct production; test files as dev-only.
3. **Fix available**: whether the source lists a fixed version. Code-pattern findings always have an action.

| Severity | direct-prod | transitive-prod | dev-only |
|---|---|---|---|
| CRITICAL | P1 | P1 | P2 |
| HIGH | P1 | P2 | P3 |
| MODERATE | P2 | P3 | P4 |
| LOW | P3 | P4 | P4 |
| UNKNOWN | P2 | P3 | P4 |

Modifier: when no fixed version exists, demote one level, but never below P2 for CRITICAL or HIGH. Every applied rule is listed in the finding's `rationale` field.

## What "pass" does and does not mean

A `pass` means: every installed version was queried against OSV and the curated advisory set listed in the report's `sources`, the rules that ran found nothing at or above your threshold, and those sources returned no known vulnerability at that level at that moment. It does not mean the project is secure. Gateseeker does not follow data flow, does not detect tampered packages that kept their version number, and does not know whether vulnerable code is reachable. The full list is in the `limitations` field of every JSON report and in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```bash
pnpm check
```

runs lint, typecheck, tests and build. Individual scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

Unit tests never reach the network: the OSV client takes an injected `fetch`, and the CLI tests run against a local HTTP server. Fixtures and their provenance are documented in [fixtures/lockfiles/README.md](fixtures/lockfiles/README.md), [fixtures/osv/README.md](fixtures/osv/README.md) and [fixtures/projects/README.md](fixtures/projects/README.md).

## Documentation

- [docs/PRODUCT.md](docs/PRODUCT.md): positioning, roadmap, decisions.
- [docs/SPRINT_0.md](docs/SPRINT_0.md), [docs/SPRINT_1.md](docs/SPRINT_1.md): scope and acceptance criteria implemented here.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, data flow, trust boundaries, limitations.
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): assets, threat agents, attack surfaces, mitigations and the tests that cover them.
- [docs/VALIDATION_SPRINT_1.md](docs/VALIDATION_SPRINT_1.md): results of the pattern rules on five real projects.
- [docs/UPSTREAM.md](docs/UPSTREAM.md): how approved advisories are submitted to OSV/GHSA.
- [advisories/README.md](advisories/README.md): the curated advisory feed, its lifecycle and format.

## License

MIT. See [LICENSE](LICENSE).

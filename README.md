# Gateseeker

Security gate for AI-generated code. *(working description; branding and tagline are pending)*

Gateseeker reads a project's `package-lock.json`, asks [OSV](https://osv.dev) which of the installed versions have known vulnerabilities, ranks each finding with deterministic, auditable rules, and returns a gate verdict with an exit code you can wire into CI.

**Sprint 0 status:** npm lockfiles (v2/v3) only, OSV as the only source, CLI only. See [docs/PRODUCT.md](docs/PRODUCT.md) for where this is going and [docs/SPRINT_0.md](docs/SPRINT_0.md) for the scope this code implements.

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
node dist/cli.js scan ./path/to/package-lock.json
```

During development you can skip the build:

```bash
pnpm dev scan fixtures/lockfiles/direct-only.package-lock.json
```

## Usage

```
gateseeker scan <package-lock.json> [options]

  --format <text|json>     Output format (default: text)
  --output <file>          Also write the JSON report to <file>
  --fail-on <P1|P2|P3|P4>  Priority threshold for a failing gate (default: P2)
  --max-size <bytes>       Reject lockfiles larger than this (default: 5242880)
  --max-deps <n>           Reject lockfiles with more packages than this (default: 5000)
  --timeout <ms>           Per-request timeout for the OSV API (default: 10000)
  --concurrency <n>        Maximum simultaneous OSV requests (default: 5)
```

### Exit codes

| Code | Verdict | Meaning |
|---|---|---|
| `0` | `pass` | Every dependency was queried and no finding reached the `--fail-on` threshold. |
| `1` | `fail` | At least one finding at or above the threshold. |
| `2` | `incomplete` | At least one query failed or a dependency could not be queried. **Never** reported as `0`, regardless of findings. |
| `3` | usage | Bad arguments, unreadable file, or lockfile rejected (malformed, unsupported version, over limits). |

`fail` takes precedence over `incomplete`: a blocking finding fails the gate even when other queries failed.

### Example output

Produced on 2026-10-27 against the live OSV API for `fixtures/lockfiles/direct-only.package-lock.json`:

```
gateseeker 0.1.0  run 30caec08-e470-4b80-942e-c5b7f2bb9eb2
lockfile       .../fixtures/lockfiles/direct-only.package-lock.json (v3)
dependencies   2 unique  (queried 2, not queried 0, failed 0)
source         osv.dev

Findings: 5  (P1 2, P2 3, P3 0, P4 0)
  [P1] lodash@4.17.20  GHSA-35jh-r3h4-6jhm (CVE-2021-23337)
       Command Injection in lodash
       severity: HIGH (CVSS 7.2)   why: base:high/direct-prod=P1, fix-available
       action:   Update lodash to 4.17.21 or later in package.json and reinstall.
       ref:      https://nvd.nist.gov/vuln/detail/CVE-2021-23337
  ...

GATE: FAIL (fail-on P2)
  5 finding(s) at priority P2 or higher.
```

## How priority is decided

Priority is a function of three facts, looked up in a single table in [src/rules/priority.ts](src/rules/priority.ts):

1. **Severity tier**, computed from the CVSS 3.x vector published by the source (or the source's qualitative rating when no vector is scorable; `UNKNOWN` when neither exists and is treated like `MODERATE`, never like `LOW`).
2. **Exposure**: direct production dependency, transitive production dependency, or dev-only.
3. **Fix available**: whether the source lists a fixed version for this package.

| Severity | direct-prod | transitive-prod | dev-only |
|---|---|---|---|
| CRITICAL | P1 | P1 | P2 |
| HIGH | P1 | P2 | P3 |
| MODERATE | P2 | P3 | P4 |
| LOW | P3 | P4 | P4 |
| UNKNOWN | P2 | P3 | P4 |

Modifier: when no fixed version exists, demote one level, but never below P2 for CRITICAL or HIGH. Every applied rule is listed in the finding's `rationale` field.

## What "pass" does and does not mean

A `pass` means: every installed version was queried and the sources consulted returned no known vulnerability at or above your threshold at that moment. It does not mean the project is secure. Gateseeker does not inspect your code, does not detect tampered packages that kept their version number, and does not know whether vulnerable code is reachable. The full list is in the `limitations` field of every JSON report and in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```bash
pnpm check
```

runs lint, typecheck, tests and build. Individual scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

Unit tests never reach the network: the OSV client takes an injected `fetch`, and the CLI tests run against a local HTTP server. Fixtures and their provenance are documented in [fixtures/lockfiles/README.md](fixtures/lockfiles/README.md) and [fixtures/osv/README.md](fixtures/osv/README.md).

## Documentation

- [docs/PRODUCT.md](docs/PRODUCT.md): positioning, roadmap, decisions.
- [docs/SPRINT_0.md](docs/SPRINT_0.md): scope and acceptance criteria implemented here.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, data flow, trust boundaries, limitations.
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): assets, threat agents, attack surfaces, mitigations and the tests that cover them.

## License

MIT. See [LICENSE](LICENSE).

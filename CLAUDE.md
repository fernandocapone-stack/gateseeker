# Gateseeker — engineering notes for AI assistants

Read `docs/SPRINT_0.md` (current scope) and `docs/PRODUCT.md` (direction) before changing anything.

## Commands

- `pnpm check` runs lint, typecheck, tests and build. Run it before declaring any task done.
- `pnpm test` runs Vitest. Tests must never reach the network: inject `fetch` into `OsvClient` or use the local HTTP server pattern in `tests/cli.test.ts`.
- `pnpm dev scan <lockfile>` runs the CLI from source.

## Non-negotiable rules

1. Never execute anything from an analyzed project. Lockfiles are text input, nothing more.
2. A failed or skipped query is never "no vulnerabilities". The verdict `incomplete` and exit code 2 exist for that; `pass` requires every dependency queried.
3. Never write "secure", "safe" or "free of vulnerabilities" in output or docs. Use "no known vulnerabilities were found in the sources consulted".
4. Priority is decided only by the tables in `src/rules/priority.ts`. Changing the table requires changing the explicit expectations in `tests/priority.test.ts` on purpose; the test does not read the table.
5. Keep the three layers apart in `Finding`: source evidence, rule conclusions, AI explanation (reserved, always `null`).
6. Validate all external data with Zod (`src/parser`, `src/intel/osv-schema.ts`). Unknown fields pass through; wrong shapes reject.
7. Treat package names, summaries, URLs and project file contents as untrusted. Terminal output goes through `sanitize()` in `src/report/text.ts`; secrets go through `redactInLine`/`redactEnvLine` in `src/patterns/redact.ts` and never appear in full anywhere.
11. Every pattern rule ships with positive, negative and suppression fixtures in `fixtures/projects/` and a ReDoS timing test. Pattern findings default to warn mode; do not flip the default to gate without measured precision (`docs/VALIDATION_SPRINT_1.md`).
8. Do not add dependencies, paid services, GitHub integration or new ecosystems without the PO's approval. Current runtime dependency: `zod` only.
9. Do not hide failures: no skipped tests, no weakened assertions, no `--no-verify`.
10. Fixtures for real vulnerabilities must be recorded from the source and documented in `fixtures/*/README.md`. Never invent advisory ids or versions.

## Layout

```
src/parser/    package-lock.json parsing and limits
src/intel/     OSV client and schema
src/rules/     CVSS scoring, severity tier, priority table, finding builder
src/patterns/  directory walker, file classifier, gitignore matcher, rule engine, rules/ (one file per GSK rule)
src/report/    text renderer
src/scan.ts    orchestration and verdict
src/cli.ts     argument parsing and exit codes
fixtures/      versioned test inputs with provenance READMEs
tests/         Vitest suites, one per module plus CLI end-to-end
```

## Toolchain pins

Node 24, pnpm 12, TypeScript 5.9 (typescript-eslint does not support TS 7 yet), Zod 4, Vitest 5, ESLint 10. Install settings live in `pnpm-workspace.yaml` (pnpm 11+ ignores `.npmrc` for them): `ignoreScripts: true`, `engineStrict: true`, and `allowBuilds: { esbuild: false }` so no dependency script ever runs.

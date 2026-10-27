# AGENTS.md

Instructions for any coding agent working in this repository. `CLAUDE.md` holds the same rules with more detail; this file is the short version.

- Scope is `docs/SPRINT_0.md`. Out-of-scope work (web UI, other ecosystems, code pattern checks, AI explanations) needs the Product Owner's approval first.
- Before coding: inspect the repo, state a short plan.
- After coding: `pnpm check` must pass. Paste real output when reporting; never claim a test passed without running it.
- Never run code from analyzed projects. Never call the network from unit tests.
- Never report a failed query as a clean result. Never use the words "secure" or "safe" for a scan result.
- Priority rules live only in `src/rules/priority.ts`; tests assert explicit expected values.
- Real vulnerability fixtures are recorded from OSV and documented in `fixtures/osv/README.md`.
- No new dependencies, services or integrations without approval. No secrets in logs, reports or commits.
- Do not delete or weaken tests to get a green run.

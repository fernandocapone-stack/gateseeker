# Contributing

Gateseeker is open core: the scanner, the rules, the curated advisory data and the GitHub Action are open; a hosted service may come later.

## Ways to help

- **Report a supply-chain incident** the official databases missed: open an issue with the public source (a vendor post, a maintainer's notice) and the affected package names. A maintainer turns it into a record under `advisories/` after review; records hold facts and links only, never third-party text.
- **Propose a code-pattern rule**: open an issue with the pattern, why it is unsafe, and a positive and a negative example. Every rule ships with fixtures for both and a timing test; see `docs/SPRINT_1.md` for the bar.
- **Fix something**: fork, branch, `pnpm install`, change, `pnpm check` (lint, typecheck, tests, build) green, pull request. Tests never reach the network.

## Rules of the house

`CLAUDE.md` and `AGENTS.md` list the non-negotiable rules for anyone (human or agent) changing this code. The short version: never execute anything from an analyzed project; a failed query is never "clean"; never write "secure"; secrets never appear in output; no new runtime dependencies without discussion.

## Reporting security issues

See `SECURITY.md`. Please do not open public issues for vulnerabilities in Gateseeker itself.

## License

Code is MIT. Advisory data under `advisories/` is CC-BY-4.0. By contributing you agree your contribution is licensed the same way.

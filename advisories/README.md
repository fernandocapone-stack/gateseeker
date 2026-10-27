# Gateseeker advisories

Curated, human-approved records of software supply-chain incidents that the official vulnerability databases miss or publish late (for example tag rewrites that keep the version number). Data in this directory is licensed CC-BY-4.0 (see `LICENSE`); the code that produces and consumes it is MIT like the rest of the repository.

## Layout

| Path | Meaning |
|---|---|
| `sources.json` | Feeds the collector reads and the relevance keywords. Only `https` URLs. Disabled entries are kept for the record: Socket and Phoenix Security return 403 to non-browser user agents; the OpenSSF malicious-packages commit feed carries only bot commit titles ("Assign IDs", "Ingest OSV"), so it adds no package names. |
| `proposed/` | Records written by the collector (or by a human) that nobody has reviewed yet. Never consumed by the scanner. |
| `approved/` | Records a named reviewer confirmed. Compiled into `dist/advisories.json` at build time and consumed by `gateseeker scan`. |
| `rejected/` | Records reviewed and found not actionable, kept so the collector does not repropose them (`status` may also be `withdrawn`). |
| `.state/seen.json` | Collector memory: canonical URLs and title hashes already seen. |

## Lifecycle

1. The `Intel feed` workflow runs every 6 hours (or manually), fetches the feeds, keeps entries whose title contains an incident word and an ecosystem word (`sources.json`), skips entries older than 30 days (remembered, not proposed), proposes at most 25 per run, extracts package-like tokens as candidates, and opens a pull request labelled `intel` with one JSON file per new entry in `proposed/`. While an `intel` pull request is open the workflow does nothing, so proposals are reviewed one batch at a time. The repository setting "Allow GitHub Actions to create and approve pull requests" must be on (enabled 2026-10-27).
2. A reviewer reads the source, fills `packages[].affected`, `type`, `severity`, `summary`, `remediation`, `window`, sets `status`, fills `review`, and moves the file to `approved/` or `rejected/`.
3. CI validates every record (`gateseeker-intel validate`): schema, status matching the directory, unique ids, `approved` needing two distinct publishers or one primary source, text limits, and no credential-looking tokens anywhere.
4. `pnpm build` compiles `approved/` into `dist/advisories.json`. The scanner matches npm dependencies against it; Packagist records are stored and validated but only matched once the `composer.lock` parser exists (Sprint 2b).
5. Approved records worth sharing are submitted upstream following `docs/UPSTREAM.md`, and the resulting id is written in `upstream`.

## What a record may contain

Facts and links only: package names, affected versions/ranges/tags, time window, indicators written in our own words, a one-line summary and a remediation written by the reviewer, and the title, URL, publisher and date of each source. Never the text of a source, never credentials, never attacker payloads.

## Record format

See `src/intel/advisory-schema.ts` for the authoritative schema and `proposed/2026-05-22-laravel-lang-tag-rewrite.json` for a complete example.

# Submitting approved advisories upstream

Gateseeker's curated records are most useful when the official databases carry them too: every `npm audit`, `composer audit` and OSV-based scanner then benefits, and the record gains an id that others can cite. This is a manual procedure, decided case by case by the PO.

## Where a record goes

| Type of incident | Destination | Why |
|---|---|---|
| Malicious code published as a package version (`malicious-version`, `typosquat`, `install-script-backdoor`) | [ossf/malicious-packages](https://github.com/ossf/malicious-packages) via pull request | OSV ingests it; records get `MAL-` ids and show up for the affected ecosystem. |
| Compromise of an existing, legitimate package (`tag-rewrite`, `compromised-maintainer`) | [github/advisory-database](https://github.com/github/advisory-database) via pull request (community contribution) | Becomes a GHSA; OSV ingests GHSA. |
| Composer-specific incidents | Also [FriendsOfPHP/security-advisories](https://github.com/FriendsOfPHP/security-advisories) | Feeds `composer audit` directly. |

## Procedure

1. Confirm the record is `approved` and has at least two independent sources or a primary one.
2. Prepare the upstream file in that project's format (OSV JSON schema for `malicious-packages`; GHSA markdown/JSON for `advisory-database`; YAML for FriendsOfPHP). Copy only facts: package, versions/ranges/tags, dates, summary in your own words, and the source URLs.
3. Open the pull request from a personal fork, citing the Gateseeker record id in the description so the provenance is traceable.
4. When the upstream id is assigned, set `upstream.osv` and/or `upstream.ghsa` in the Gateseeker record and commit.
5. If upstream rejects or amends the record, update ours accordingly; a disagreement with a well-sourced upstream review is a reason to revisit our `status`.

## What never goes upstream

Records in `proposed` or `rejected` state, attacker payloads, credentials, or text copied from third-party posts. Gateseeker's data license (CC-BY-4.0) permits reuse; upstream projects have their own licenses and contribution agreements, which the submitter accepts on their own behalf.

## First candidate

`GSK-ADV-2026-0001` (Laravel-Lang tag rewrite, May 2026): a compromise of existing packages without a new version. Destination: `github/advisory-database` as a community GHSA for each of the four Composer packages, plus FriendsOfPHP. On 2026-10-27 OSV had no record for any of them.

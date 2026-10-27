# Sprint 2b validation on real PHP projects

> Date: 2026-10-27. Scope: dependency analysis only (`--only deps`), with and without `--baseline`. Approved by the PO: cloning the five public repositories below into an isolated scratch directory, scanning them, classifying every supply-chain finding by hand, recording the result here. Clones and reports were deleted afterwards; no secret value is recorded.

## Sample

| # | Repository | HEAD | Baseline `composer.lock` (previous commit touching it) | Why |
|---|---|---|---|---|
| 1 | monicahq/monica | `6e6ec21` | `38600b7` (2025-07-27) | The only popular Laravel app depending on the four Laravel-Lang packages (in `require-dev`). Expected true negative: its lock was not regenerated inside the attack window. |
| 2 | pterodactyl/panel | `90b2aa8` | `c39a7be` (2026-06-28) | Large dependency jump between baseline and HEAD (Laravel 11 to 12). |
| 3 | cachethq/cachet | `40bd081` | `c01c2bb` (2026-09-28) | Depends on its own core package from a `dev-main` branch. |
| 4 | krayin/laravel-crm | `5eecae0` | `2e446d9` (2026-08-18) | Baseline with packages added, none changed. |
| 5 | solidtime-io/solidtime | `93eb93f` | `2dadf1e` (2026-09-24) | Has both `composer.lock` and `package-lock.json` (829 dependencies in total). |

Baselines were downloaded with the GitHub API (read-only); Gateseeker itself never ran git.

## Results (with baseline, after the rule adjustments below)

| Project | Deps | OSV: vulnerable / clean / not queried | Vulnerability findings | Packagist checks | Supply-chain findings | Verdict |
|---|---|---|---|---|---|---|
| monica | 241 | 18 / 226 / 1 | 60 | 4 (all verified, no mismatch) | 0 | fail (OSV) |
| panel | 170 | 6 / 164 / 0 | 19 | 0 | 1 (`GSK-SC-002`, MODERATE) | fail (OSV) |
| cachet | 181 | 1 / 179 / 1 | 1 (P3) | 0 | 1 (`GSK-SC-001`, MODERATE) | incomplete |
| laravel-crm | 186 | 8 / 177 / 1 | 15 | 0 | 0 | fail (OSV) |
| solidtime | 829 | 20 / 809 / 0 | 56 | 0 | 0 | fail (OSV) |

"Not queried" entries are `dev-*` branch packages, which no registry can look up. The OSV findings are known CVEs of the pinned versions and were not classified individually; they come verbatim from OSV.

## Manual classification of supply-chain findings

### Curated advisory `GSK-ADV-2026-0001` (Laravel-Lang) via Packagist

Monica pins `laravel-lang/lang 15.22.7`, `attributes 2.13.5`, `http-statuses 3.10.4` and `actions 1.10.2` at commits dated 2025. The scanner fetched each package's Packagist metadata, found the same commit for the same version and a release time outside the window, and produced no finding. **4 verified true negatives.** The positive case (a lock regenerated inside the window) was not found in any public repository; it is covered by the synthetic pair in `fixtures/composer/laravel-lang-case/` and by the unit tests that reproduce both the mismatch and the in-window cases.

### Structural rules

| Where | Rule | First run | Verdict | What changed |
|---|---|---|---|---|
| monica, `roave/security-advisories@dev-master` | GSK-SC-003 | fired (P2) | **False positive.** A `dev-master` "version" moves with every commit by design; a changed commit for the same branch name is not a rewritten tag. | Rule now skips branch versions (`pinnedToCommit`); GSK-SC-001 is the rule for branches. Test added. |
| cachet, `cachethq/core@dev-main` | GSK-SC-003 | fired (P1) | **False positive**, same reason. | Same fix. |
| cachet, `cachethq/core@dev-main` | GSK-SC-001 | fired (P2) | **True positive.** The application depends on its own core package from a branch in production; whoever can push to that branch ships code at the next install. Low surprise for the maintainers, correct as a signal. | None. |
| panel, `laravel/framework 11.47.0 → 12.64.0` | GSK-SC-002 | fired (P1, HIGH) | **True positive, informational.** Laravel 12 added `src/Illuminate/Reflection/helpers.php` to `autoload.files`. Real new bootstrap code, legitimate release. HIGH was too much for a version bump. | Severity is now HIGH only when the version did not change (the tag-rewrite pattern) and MODERATE for a version bump. Test added. |
| all | GSK-SC-004, GSK-SC-005 | no findings | Not exercised: no package in the sample was released within 3 days of the run, and no source host changed. | None. |

Precision after adjustments, on this sample: GSK-SC-001 1/1, GSK-SC-002 1/1 (informational), GSK-SC-003 0 findings (2 false positives eliminated), GSK-SC-004 and GSK-SC-005 unmeasured.

### Parser adjustment found by the sample

`psr/http-message 2.0` and `scrivo/highlight.php v9.18.1.10` were classified "non-semver" and left unqueried. Composer allows 2- to 4-part numeric versions, and registries index them as written, so the parser now queries them. After the change, every project has at most one unqueried dependency (its `dev-*` branch package).

## What this validation does not show

- No public project regenerated its lock inside the Laravel-Lang window, so the tag-rewrite detection has no real-world positive here. Its logic is tested against the recorded Packagist metadata and the synthetic fixtures, and the mismatch check ran for real against Packagist on Monica.
- Baselines are one commit back; the diff rules saw ordinary updates only. GSK-SC-004 needs a run close to a release date to fire.
- `cachet` ends `incomplete` because a `dev-main` dependency cannot be queried; that is by design (an unqueried dependency is never "clean"), but teams that depend on branches will see it on every run until they pin a release. Documented in README.

## Gate eligibility

GSK-SC-001 and GSK-SC-002 behaved correctly on real projects; GSK-SC-003 had two false positives that are now excluded by construction. All five rules stay in warn mode by default; `--supply-chain gate` is explicit. No rule is marked experimental, but GSK-SC-003/004/005 have no measured positive on real code yet.

## Reproduction

```bash
git clone --depth 1 https://github.com/<owner>/<repo>.git /tmp/gs-2b/<repo>
```

```bash
node dist/cli.js scan /tmp/gs-2b/<repo> --only deps --baseline /tmp/gs-2b/<repo>.baseline.composer.lock --format json --output /tmp/gs-2b/<repo>.json
```

The baseline for each project was `composer.lock` at the commit listed in the sample table.

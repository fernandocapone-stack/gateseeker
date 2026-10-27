# Composer fixtures

Synthetic `composer.lock` files. Shapes follow real Composer 2 lockfiles; every reference hash and content-hash is fake (repeated digits) so nothing here points at a real commit. Package names of real projects (`laravel/framework`, `laravel-lang/lang`, `monolog/monolog`, `phpunit/phpunit`) are used so the tests exercise realistic names, with versions that exist.

| Path | Scenario |
|---|---|
| `basic/composer.json` + `basic/composer.lock` | Two direct production dependencies, one transitive (`monolog`), one dev (`phpunit`), one `dev-main` package (non-semver), one `path` package with an install script and `autoload.files` (non-registry). |
| `malformed-schema.composer.lock` | Valid JSON, `packages` is an object. Must be rejected. |
| `laravel-lang-case/` | Pair of lockfiles reproducing the May 2026 Laravel-Lang pattern: `before.composer.lock` pins the packages at commits dated before 2026-05-22T22:32Z; `after.composer.lock` keeps the same versions but points at different commits dated inside the attack window and adds `autoload.files: ["src/helpers.php"]`. Built from the facts in `advisories/approved/2026-05-22-laravel-lang-tag-rewrite.json`; contains no attacker code. |
| `normal-update/` | Pair of lockfiles with an ordinary update: versions change and commits change together. Must produce no `GSK-SC-003`. |

Malformed JSON, oversize and too-many-packages cases are generated inside `tests/composer.test.ts`.

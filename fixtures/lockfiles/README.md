# Lockfile fixtures

Hand-written `package-lock.json` files. Integrity hashes marked `fixture` are placeholders; the parser does not verify them. Versions of real packages (`lodash@4.17.20`, `zod@4.6.7`) are real and match the OSV fixtures in `../osv/`.

| File | Scenario |
|---|---|
| `direct-only.package-lock.json` | v3, two direct production dependencies, no transitive. |
| `transitive.package-lock.json` | v3, one direct prod dep with a transitive (`ms@2.1.2`), one direct dev dep with a nested transitive copy (`ms@2.0.0`, dev). |
| `v2.package-lock.json` | v2 with both `packages` and legacy `dependencies` blocks; only `packages` is read. |
| `v1.package-lock.json` | v1, no `packages` block. Must be rejected. |
| `malformed-json.package-lock.json` | Truncated JSON. Must be rejected. |
| `malformed-schema.package-lock.json` | Valid JSON, `packages` is an array. Must be rejected. |
| `odd-versions.package-lock.json` | Missing version, git source, `file:` symlink, non-semver version, plus one normal dep. |

| `pnpm/pnpm-lock.yaml` + `package.json` | pnpm 9 format as written by pnpm 12: a first YAML document with the package manager's own lock (must be ignored), then the project. Same project as `transitive` plus `lodash@4.17.20`, a git dependency keyed by tarball URL and a `link:` workspace dependency. |
| `yarn-v1/yarn.lock` + `package.json` | The same project in Yarn 1's format, with a merged `lodash@4.17.20, lodash@^4.17.20` header and the git dependency. |
| `yarn-berry/yarn.lock` + `package.json` | The same project in Yarn Berry's format (`__metadata` version 8), with the root `workspace:.` entry and a `patch:` copy of `typescript@5.4.5` (real version) that must not be queried twice. |

The pnpm and Yarn files are hand-written in each tool's format, like the npm ones: integrity values and checksums are `fixture` placeholders that the parsers do not verify; `tiny-git-dep`, `fake-test-runner` and `local-tool` are fictitious and never queried for real.

Size and dependency-count limits are exercised with generated inputs in `tests/parser.test.ts` rather than committed multi-megabyte files.

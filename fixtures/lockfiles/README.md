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

Size and dependency-count limits are exercised with generated inputs in `tests/parser.test.ts` rather than committed multi-megabyte files.

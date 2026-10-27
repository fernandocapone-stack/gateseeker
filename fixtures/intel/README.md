# Intel fixtures

| Path | Origin | Scenario |
|---|---|---|
| `feeds/stepsecurity-blog.rss.xml` | **Real.** Recorded 2026-10-27 from `https://www.stepsecurity.io/blog/rss.xml`. | RSS 2.0 with real supply-chain posts, including the Laravel-Lang one. Only titles, links and dates are read by the parser. |
| `feeds/ossf-malicious-packages-commits.atom.xml` | **Real.** Recorded 2026-10-27 from `https://github.com/ossf/malicious-packages/commits/main.atom`. | Atom feed; every entry title mentions a malicious package. |
| `advisories/approved-npm-synthetic.json` | Synthetic. | Valid `approved` record for a fictitious npm package with `versions` and `ranges`. Matched by `fixtures/lockfiles/advisory-match.package-lock.json`. |
| `advisories/proposed-npm-synthetic.json` | Synthetic. | Valid `proposed` record for a package present in the same lockfile. Must never produce a finding. |

Invalid variants (missing reviewer, single publisher, long summary, http URL, embedded credential, non-semver version) are derived from the valid record inside `tests/intel.test.ts`. Malformed, oversized and entity-declaring feeds are generated inside the tests.

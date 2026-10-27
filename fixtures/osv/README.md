# OSV response fixtures

Recorded or constructed responses of `POST https://api.osv.dev/v1/query`. Unit tests replay them through an injected `fetch`; no test reaches the network.

| File | Origin | Scenario |
|---|---|---|
| `lodash-4.17.20.json` | **Real.** Recorded on 2026-10-27 from the live API for `{"package":{"name":"lodash","ecosystem":"npm"},"version":"4.17.20"}`. Only `details` texts longer than 400 characters were truncated (marked `[truncated in fixture]`); every other field is verbatim. Contains 5 records, including `GHSA-35jh-r3h4-6jhm` / `CVE-2021-23337` (HIGH, fixed in 4.17.21). Verify at <https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm>. | Known vulnerability with severity and fixed version. |
| `zod-4.6.7.json` | **Real.** The live API returned `{}` for `zod@4.6.7` on 2026-10-27. | No known vulnerabilities. |
| `invalid-schema.json` | Synthetic. | `vulns` is an object instead of an array; must be treated as a failed query. |
| `no-severity.json` | Synthetic, id `GSK-TEST-0001`, package `example-pkg`. | Vulnerability with neither CVSS nor declared severity; tier must be UNKNOWN. |

Timeout and network failure scenarios need no file: they are simulated by the injected `fetch` in `tests/osv.test.ts`.

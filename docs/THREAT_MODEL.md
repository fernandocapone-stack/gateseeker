# Threat model (Sprint 0)

Gateseeker processes attacker-controlled input (a lockfile from any project) and data from an external service (OSV), and prints results into a terminal and a file. This document lists what we protect, who might attack, where, how we mitigate, and which test proves each mitigation.

## Assets

| Asset | Why it matters |
|---|---|
| Integrity of the verdict | A false `pass` is the worst outcome: a user ships a vulnerable dependency believing the gate approved it. |
| Availability of the tool | A crafted input that hangs or crashes the scanner blocks a CI pipeline. |
| The user's machine and CI runner | The scanner must never become a vector for executing attacker code. |
| The user's terminal and logs | Output must not be able to spoof results or inject escape sequences. |
| Trust in the tool | Invented or misattributed findings destroy the product's only differentiator. |

## Threat agents

- **Malicious project author**: publishes a repository whose `package-lock.json` is crafted to crash, hang, or mislead the scanner.
- **Malicious package maintainer**: controls a package name, version string or (indirectly) advisory text that ends up in the report.
- **Network attacker / compromised source**: tampers with, delays or blocks OSV responses.
- **Careless user**: runs the tool on untrusted repositories expecting it to be safe to do so.

## Attack surfaces and mitigations

### 1. Lockfile parsing

| Threat | Mitigation | Test |
|---|---|---|
| Multi-gigabyte file exhausts memory | Byte-length check before `JSON.parse`; default 5 MB, configurable `--max-size`. | `parser.test.ts` "rejects files above the size limit", "rejects a generated lockfile larger than the default limit", `cli.test.ts` oversize → exit 3 |
| Hundreds of thousands of packages exhaust time or OSV quota | Package-count limit, default 5000, configurable `--max-deps`. | `parser.test.ts` "rejects lockfiles with more packages than allowed" |
| Malformed JSON crashes the process | `JSON.parse` wrapped; returns a typed `malformed-json` error, exit 3. | `parser.test.ts` "rejects malformed JSON", `cli.test.ts` |
| Unexpected structure (prototype-pollution style keys, arrays where objects are expected) | Zod `looseObject` schemas; rejection on shape mismatch; parsed values are plain data, never merged into existing objects. | `parser.test.ts` "rejects valid JSON that does not match the schema", "rejects a non-object root" |
| Lifecycle scripts or `require` of project code | The parser never resolves, requires or executes anything; input is a string. The tool's own installs run with `ignore-scripts=true`. | By construction; see `src/parser/lockfile.ts` (no `child_process`, no dynamic import) |
| Ambiguous versions used to fake a clean result | Missing/non-semver/non-registry versions are `not-queried`, which forces `incomplete`, never `pass`. | `scan.test.ts` "marks dependencies with unusable versions as not-queried" |

### 2. OSV communication

| Threat | Mitigation | Test |
|---|---|---|
| Source unavailable → treated as clean | Any HTTP error, network error or timeout is `query-failed`; verdict becomes `incomplete`, exit 2. | `osv.test.ts` HTTP/network/timeout cases; `scan.test.ts` "marks the run incomplete when a query fails"; `cli.test.ts` exit 2 |
| Slow or hanging server stalls CI | Per-request `AbortController` timeout (default 10 s, `--timeout`). | `osv.test.ts` "aborts after the timeout" |
| Flood of requests from a large project | Concurrency limit (default 5, `--concurrency`) and per-run memoisation of identical queries. | `osv.test.ts` "never exceeds the concurrency limit", "memoises identical queries" |
| Malformed or tampered response | Zod schema validation; schema mismatch or non-JSON is `query-failed`, not an empty result. | `osv.test.ts` "treats a response outside the OSV schema as a failed query", "treats non-JSON bodies as failed queries" |
| Endless pagination | Hard cap of 20 pages; exceeding it is a failure. | `osv.test.ts` "fails instead of looping forever" |
| Fixed-version data for a different package used as remediation | Fixed versions are taken only from `affected` entries whose `package.name` and `ecosystem` match the queried dependency. | `priority.test.ts` "extracts fixed versions only for the queried package" |

Residual: Gateseeker trusts TLS and OSV itself. A compromise of osv.dev or of the client's CA store is out of scope.

### 3. Output

| Threat | Mitigation | Test |
|---|---|---|
| Package name or advisory summary containing ANSI escapes or newlines spoofs a `GATE: PASS` line | `sanitize()` strips C0/C1 controls, DEL, U+2028/2029 and collapses newlines before any untrusted string is printed; values are truncated. | `cli.test.ts` "strips control characters", "renders an untrusted summary without letting it break lines" |
| Attacker-controlled URL in `ref:` is auto-opened | Nothing is opened; URLs are printed as text only. | By construction |
| Secrets leaked in report | The tool handles no credentials; the report contains only lockfile data, OSV data and derived fields. | `.gitignore` excludes local reports; no auth code exists |

### 4. Language and interpretation

| Threat | Mitigation | Test |
|---|---|---|
| User reads `pass` as "secure" | Wording is fixed: "No known vulnerabilities were found in the sources consulted." The report carries a `limitations` list on every run. | `cli.test.ts` asserts the wording and the absence of "secure/safe/free of" |
| Invented findings | Findings are built only from records returned by OSV; identifiers and references are copied verbatim. Real fixtures are recorded from the live API and documented. | `osv.test.ts`, `priority.test.ts` against the recorded lodash record; `fixtures/osv/README.md` |
| AI layer takes action | No AI exists in this version. The `aiExplanation` field is reserved and always `null`. | `cli.test.ts` asserts `aiExplanation === null` for every finding |

## Residual risks

- A dependency that is vulnerable but not yet in OSV yields `no-known-vulnerabilities`. This is inherent to any advisory-based scanner and is why the wording is cautious.
- Supply-chain compromises that keep the version number are invisible to this version (see `docs/PRODUCT.md`, Sprint 2).
- A `pass` is a statement about the sources at query time only. There is no monitoring between runs.
- OSV's version matching is performed server-side; Gateseeker does not independently evaluate affected ranges against the installed version.
- Priority does not account for reachability, so some P1/P2 findings may be unreachable in practice and some P3/P4 findings may matter more than their rank suggests.

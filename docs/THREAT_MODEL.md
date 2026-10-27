# Threat model (after Sprint 1)

Gateseeker processes attacker-controlled input (any project's files and lockfile), data from an external service (OSV), and prints results into a terminal and a file. This document lists what we protect, who might attack, where, how we mitigate, and which test proves each mitigation.

## Assets

| Asset | Why it matters |
|---|---|
| Integrity of the verdict | A false `pass` is the worst outcome: a user ships a vulnerable dependency or an open database believing the gate approved it. |
| Availability of the tool | A crafted input that hangs or crashes the scanner blocks a CI pipeline. |
| The user's machine and CI runner | The scanner must never become a vector for executing attacker code or reading files outside the project. |
| Secrets found in the project | The scanner sees real credentials; it must never copy them into reports, logs or terminals. |
| The user's terminal and logs | Output must not be able to spoof results or inject escape sequences. |
| Trust in the tool | Invented, misattributed or noisy findings destroy the product's only differentiator. |

## Threat agents

- **Malicious project author**: publishes a repository whose files are crafted to crash, hang, mislead, or exfiltrate through the scanner.
- **Malicious package maintainer**: controls a package name, version string or advisory text that ends up in the report.
- **Network attacker / compromised source**: tampers with, delays or blocks OSV responses.
- **Careless user**: runs the tool on untrusted repositories expecting it to be safe to do so, or shares a report without realising it contains secrets.

## Attack surfaces and mitigations

### 1. Project file system (directory scans)

| Threat | Mitigation | Test |
|---|---|---|
| Symlink pointing outside the project (`/etc`, home directory) makes the scanner read or report foreign files | `lstat` + `isSymbolicLink()` skip; links are counted, never followed. Containment check rejects any resolved path outside the root. | `patterns.test.ts` "does not follow symbolic links" |
| Huge trees or huge files exhaust memory or time | Limits on file count (5000), text file size (1 MB) and depth (20), configurable; exceeding aborts with exit 3. Binary files are skipped by extension and by a NUL probe before being read as text. | `patterns.test.ts` walker limit tests; `cli.test.ts` "walker limits reject the input with exit 3" |
| Pathological lines trigger catastrophic regex backtracking | Lines over 5000 characters are skipped by rules; every secret pattern is run against nine 1 MB adversarial inputs with a 200 ms budget. | `patterns.test.ts` "regex safety (ReDoS budget)" |
| A rule throws on unexpected content and the scan dies or silently loses findings | Rule exceptions are caught per file and surfaced as a `GSK-ENGINE-000` finding. | By construction in `engine.ts` (`try/catch` around `rule.check`) |
| Project code executed through `require`, `import`, or build steps | The walker reads bytes only. No dynamic import, no child process, no evaluation anywhere in `src/patterns`. | By construction; `grep -r "child_process\|eval(\|import(" src/patterns` is empty |
| `node_modules` planted with secrets or patterns to flood the report | `node_modules`, build outputs and `.git` are always skipped; the root `.gitignore` is honoured. | `patterns.test.ts` "skips always-ignored dirs..." |
| Fake suppressions silence real findings | A suppression needs an explicit rule id and a non-empty reason, is listed in the report, and a reasonless one is reported as a warning. | `patterns.test.ts` CORS test (both the valid and invalid suppression) |

### 2. Secrets handling

| Threat | Mitigation | Test |
|---|---|---|
| A real credential found in the project is copied into the report, terminal or CI log | Matched tokens are replaced by `<first 4 chars>…[N chars]`; dotenv values are hidden entirely; snippets are built only through `redactInLine` / `redactEnvLine`. | `patterns.test.ts` "never writes a full secret into the findings"; `cli.test.ts` asserts every fixture secret is absent from both text and JSON output |
| JWT payload decoding executes or trusts attacker data | Decoding is `Buffer.from(...)` + `JSON.parse` in a try/catch, reading one string field; the signature is never verified or used. | `patterns.test.ts` "decodes JWT roles without trusting the signature" |

### 3. Lockfile parsing

| Threat | Mitigation | Test |
|---|---|---|
| Multi-gigabyte file exhausts memory | Byte-length check before `JSON.parse`; default 5 MB, configurable. | `parser.test.ts` size tests; `cli.test.ts` oversize → exit 3 |
| Hundreds of thousands of packages exhaust time or OSV quota | Package-count limit, default 5000. | `parser.test.ts` "rejects lockfiles with more packages than allowed" |
| Malformed JSON or unexpected structure crashes the process | `JSON.parse` wrapped; Zod `looseObject` schemas; typed rejection, exit 3. | `parser.test.ts` rejection tests |
| Ambiguous versions used to fake a clean result | Missing/non-semver/non-registry versions are `not-queried`, which forces `incomplete`, never `pass`. | `scan.test.ts` "marks dependencies with unusable versions as not-queried" |

### 4. OSV communication

| Threat | Mitigation | Test |
|---|---|---|
| Source unavailable → treated as clean | Any HTTP error, network error or timeout is `query-failed`; verdict becomes `incomplete`, exit 2. | `osv.test.ts`; `scan.test.ts`; `cli.test.ts` exit 2 |
| Slow or hanging server stalls CI | Per-request `AbortController` timeout. | `osv.test.ts` "aborts after the timeout" |
| Flood of requests | Concurrency limit and per-run memoisation. | `osv.test.ts` concurrency and memoisation tests |
| Malformed or tampered response | Zod validation; mismatch is `query-failed`, not an empty result. | `osv.test.ts` schema and non-JSON tests |
| Endless pagination | Hard cap of 20 pages. | `osv.test.ts` "fails instead of looping forever" |
| Fixed-version data for a different package used as remediation | Fixed versions come only from `affected` entries matching the queried name and ecosystem. | `priority.test.ts` "extracts fixed versions only for the queried package" |

Residual: Gateseeker trusts TLS and OSV itself.

### 5. Output

| Threat | Mitigation | Test |
|---|---|---|
| Package name, advisory summary or code snippet containing ANSI escapes or newlines spoofs a `GATE: PASS` line | `sanitize()` strips C0/C1 controls, DEL, U+2028/2029 and collapses newlines before any untrusted string is printed; values are truncated. | `cli.test.ts` "strips control characters", "renders an untrusted summary without letting it break lines" |
| Attacker-controlled URL in `ref:` is auto-opened | Nothing is opened; URLs are printed as text only. | By construction |

### 6. Language and interpretation

| Threat | Mitigation | Test |
|---|---|---|
| User reads `pass` as "secure" | Fixed wording: "No known vulnerabilities or insecure patterns were found in the sources consulted." Every report carries `analyses` and `limitations`. | `cli.test.ts` asserts the wording and the absence of "secure/safe/free of" as words |
| Pattern rules with unmeasured precision block builds | Pattern findings are `warn` by default and only gate with `--patterns gate`; precision on real projects is tracked in `docs/VALIDATION_SPRINT_1.md`. | `patterns.test.ts` "gate mode counts pattern findings in the verdict"; `cli.test.ts` warn vs gate |
| Invented findings | Dependency findings come only from OSV records, copied verbatim; pattern findings cite file, line and a redacted snippet. | `osv.test.ts`, `priority.test.ts`, `patterns.test.ts` |
| AI layer takes action | No AI exists in this version. `aiExplanation` is reserved and always `null`. | `cli.test.ts` asserts `aiExplanation === null` |

## Residual risks

- A dependency that is vulnerable but not yet in OSV yields `no-known-vulnerabilities`.
- Supply-chain compromises that keep the version number are invisible to this version.
- Pattern rules miss anything expressed indirectly (configuration through variables, SQL outside migrations, secrets without a recognisable prefix) and may misclassify files in unconventional layouts.
- A `pass` is a statement about the sources and rules at scan time only.
- Priority does not account for reachability or for how the application is deployed.

# Threat model (after Sprint 2b)

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

### 5. Registry lookups and baseline comparison (Sprint 2b)

| Threat | Mitigation | Test |
|---|---|---|
| Packagist unavailable or tampered makes a rewritten tag look clean | Lookups are https-only to a fixed host with timeout and schema validation; a failed or missing lookup keeps the time-based match, marks it unverified and records a failed query (verdict `incomplete`). | `supplychain.test.ts` "matches by time inside the window and marks it unverified…", "with --no-packagist…" |
| Registry still serves the poisoned tag (not yet restored) | The registry's own commit date is checked against the incident window, not just the reference equality. | `supplychain.test.ts` "matches (verified) when the registry still serves a commit dated inside the rewrite window" |
| Attacker-controlled baseline lockfile hides a change | Both lockfiles' SHA-256 and the diff summary are printed; the baseline must be of the same kind as the scanned lock. | `supplychain.test.ts` "rejects a baseline of another lockfile kind"; `cli.test`/`supplychain.test` baseline output |
| composer.lock crafted to crash or hang the parser | Same limits as npm (5 MB, 5000 packages), Zod schema, no execution; `composer.json` optional and tolerated when broken. | `composer.test.ts` |
| Structural rules block builds on noise before precision is known | GSK-SC-* run in warn mode by default; `--supply-chain gate` is explicit. | `supplychain.test.ts` scan test (verdict with warn mode) |

### 6. Public feeds and the curated advisory set

| Threat | Mitigation | Test |
|---|---|---|
| A feed serves a huge body, hangs, or redirects to another host | 2 MB limit (declared and actual), 10 s timeout, `redirect: manual` with same-host check only. | `intel.test.ts` "refuses oversized bodies, timeouts and cross-host redirects" |
| XML external entities or DOCTYPE tricks in a feed | Parser refuses any document containing `<!DOCTYPE` or `<!ENTITY`; no XML library is used. | `intel.test.ts` "refuses documents with DOCTYPE or ENTITY" |
| HTML or control characters in titles reach the repository or terminal | Tags stripped, entities decoded with a fixed table, `sanitize()` applied, length capped. | `intel.test.ts` "flattens HTML in titles..." |
| A crafted feed entry floods the repository with proposals | Entry cap per feed (200), keyword filter, dedup by canonical URL and title hash, one PR per run reviewed by a human. | `intel.test.ts` collector tests |
| A malicious or mistaken record becomes a finding | Only `approved` records with a named reviewer and two publishers (or a primary source) are matched; `proposed`/`rejected` never match; CI validates on every push; the scanner validates again at load time and rejects a bad `--advisories` file with exit 3. | `intel.test.ts` schema and matching tests; `cli.test.ts` --advisories tests |
| Third-party text or credentials pasted into a record | Text limits on `summary`/`notes`, credential-pattern rejection over the whole record, review guidance in `advisories/README.md`. | `intel.test.ts` "credential-looking token in notes", "summary over 300 chars" |
| The workflow token is abused | Write permissions only in the `Intel feed` workflow, scoped to contents and pull requests; the main CI stays read-only; nothing merges automatically. | By construction (`.github/workflows/intel.yml`) |

### 7. Local triage interface

| Threat | Mitigation | Test |
|---|---|---|
| Another process or site on the machine drives the triage API | Server binds to 127.0.0.1 only; every `/api/*` call needs the per-session token the CLI prints; the UI removes the token from the URL after reading it; CSP `connect-src 'self'`. | `ui-server.test.ts` "requires the session token"; e2e "the page refuses to work without the session token" |
| Path traversal through the static file server | Paths normalized and confined to `ui/dist`; anything outside is refused. | `ui-server.test.ts` "does not serve files outside the UI directory" |
| The interface is tricked into running destructive git commands | Allowlisted runner (`add`, `commit`, `push`, `fetch`, `merge --no-edit`, read-only queries); force/hard/delete/amend/no-verify flags refused before execution. | `ui-server.test.ts` "git allowlist" |
| A client bypasses the approval rules | The server re-validates every decision with the same Zod schema as CI (two publishers or a primary source, text limits, credential patterns); the id comes from the pending record on disk; drafts are stripped. | `ui-server.test.ts` approve/reject tests; e2e approval test |
| Decisions without an accountable reviewer | Reviewer is read from git `user.name`; approve/reject are refused when it is missing. | `ui-server.test.ts` "refuses to approve when git has no user.name" |
| Embedded source page attacks the interface | The source is shown in a sandboxed iframe (`allow-scripts allow-same-origin` on the remote origin only), with `referrerpolicy=no-referrer`; the app itself never reads from it. | By construction (`ReviewForm.tsx`) |

### 8. Output

| Threat | Mitigation | Test |
|---|---|---|
| Package name, advisory summary or code snippet containing ANSI escapes or newlines spoofs a `GATE: PASS` line | `sanitize()` strips C0/C1 controls, DEL, U+2028/2029 and collapses newlines before any untrusted string is printed; values are truncated. | `cli.test.ts` "strips control characters", "renders an untrusted summary without letting it break lines" |
| Attacker-controlled URL in `ref:` or in an advisory source is auto-opened | Nothing is opened; URLs are printed as text only. | By construction |

### 9. Language and interpretation

| Threat | Mitigation | Test |
|---|---|---|
| User reads `pass` as "secure" | Fixed wording: "No known vulnerabilities or insecure patterns were found in the sources consulted." Every report carries `analyses` and `limitations`. | `cli.test.ts` asserts the wording and the absence of "secure/safe/free of" as words |
| Pattern rules with unmeasured precision block builds | Pattern findings are `warn` by default and only gate with `--patterns gate`; precision on real projects is tracked in `docs/VALIDATION_SPRINT_1.md`. | `patterns.test.ts` "gate mode counts pattern findings in the verdict"; `cli.test.ts` warn vs gate |
| Invented findings | Dependency findings come only from OSV records, copied verbatim; pattern findings cite file, line and a redacted snippet. | `osv.test.ts`, `priority.test.ts`, `patterns.test.ts` |
| AI layer takes action | No AI exists in this version. `aiExplanation` is reserved and always `null`. | `cli.test.ts` asserts `aiExplanation === null` |

## Residual risks

- A dependency that is vulnerable but not yet in OSV yields `no-known-vulnerabilities`.
- Supply-chain compromises that keep the version number are detected only once a reviewer has approved a record about them; the curated set is as good as its sources and reviewers.
- Pattern rules miss anything expressed indirectly (configuration through variables, SQL outside migrations, secrets without a recognisable prefix) and may misclassify files in unconventional layouts.
- A `pass` is a statement about the sources and rules at scan time only.
- Priority does not account for reachability or for how the application is deployed.

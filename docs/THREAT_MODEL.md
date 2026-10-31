# Threat model (after Sprint 4)

Gateseeker processes attacker-controlled input (any project's files and lockfile), data from an external service (OSV), and prints results into a terminal and a file. Since Sprint 4 it also runs as a hosted service (Vercel functions + Supabase) that downloads public GitHub repositories on behalf of signed-in users. This document lists what we protect, who might attack, where, how we mitigate, and which test proves each mitigation.

## Assets

| Asset | Why it matters |
|---|---|
| Integrity of the verdict | A false `pass` is the worst outcome: a user ships a vulnerable dependency or an open database believing the gate approved it. |
| Availability of the tool | A crafted input that hangs or crashes the scanner blocks a CI pipeline. |
| The user's machine and CI runner | The scanner must never become a vector for executing attacker code or reading files outside the project. |
| Secrets found in the project | The scanner sees real credentials; it must never copy them into reports, logs or terminals. |
| The user's terminal and logs | Output must not be able to spoof results or inject escape sequences. |
| Trust in the tool | Invented, misattributed or noisy findings destroy the product's only differentiator. |
| Saved reports and accounts (hosted) | A report belongs to the account that produced it; another user must not read it by guessing or enumerating ids. |
| Hosting quota and cost (hosted) | Vercel, Supabase, OSV and the anonymous GitHub API limit are shared; abuse can deny service to every user or create a bill. |

## Threat agents

- **Malicious project author**: publishes a repository whose files are crafted to crash, hang, mislead, or exfiltrate through the scanner.
- **Malicious package maintainer**: controls a package name, version string or advisory text that ends up in the report.
- **Network attacker / compromised source**: tampers with, delays or blocks OSV responses.
- **Abusive visitor (hosted)**: signs in only to burn the shared quota, submits hostile URLs, or crafts a repository whose archive attacks the extractor.
- **Careless user**: runs the tool on untrusted repositories expecting it to be safe to do so, or shares a report without realising it contains secrets.

## Attack surfaces and mitigations

### 1. Project file system (directory scans)

| Threat | Mitigation | Test |
|---|---|---|
| Symlink pointing outside the project (`/etc`, home directory) makes the scanner read or report foreign files | `lstat` + `isSymbolicLink()` skip; links are counted, never followed. Containment check rejects any resolved path outside the root. | `patterns.test.ts` "does not follow symbolic links" |
| Huge trees or huge files exhaust memory or time | Limits on file count (5000) and depth (20), configurable; exceeding aborts with exit 3. A file above the size limit (1 MB, configurable) is skipped without being read and listed in the report's limitations (since 2026-10-30, PO decision; it used to abort). Binary files are skipped by extension and by a NUL probe before being read as text. | `patterns.test.ts` "aborts on too many files, and skips and lists oversize files"; `cli.test.ts` "the file-count limit rejects the input with exit 3; oversize files are skipped and listed" |
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
| Crafted YAML in pnpm-lock.yaml or a Berry yarn.lock (prototype keys, deep nesting, huge documents, pathological quoting) | Own YAML-subset reader, no dependency: linear line-by-line pass, no anchors/aliases/tags/evaluation, maps created without a prototype, `__proto__`/`constructor`/`prototype` keys refused, duplicate keys refused, depth (32) and entry (500,000) caps, byte limit before parsing; the result is validated with Zod. Yarn 1's own format is read by a separate line reader with the same refusals. | `js-lock.test.ts` "refuses prototype keys, duplicates, tabs and bad indentation", "splits documents and caps depth", "stays fast on adversarial input" |
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

### 8. GitHub Action and publication

| Threat | Mitigation | Test |
|---|---|---|
| The Action runs a scanner version other than the one released with it | `action.yml` pins the npm version; `release.yml` refuses a tag that does not match `package.json`; the floating major tag only moves on release. | By construction; release workflow check |
| Published package carries fixtures, tests or feed data | `files` allow-list in `package.json`; CI and the release workflow run `npm pack --dry-run` and fail on unexpected paths. | CI step "Verify package contents" |
| Package tampered between build and registry | npm provenance (OIDC) on every publish; consumers verify with `npm audit signatures`. | By construction (`publishConfig.provenance`) |
| Crafted Action inputs | Enumerations validated, numbers parsed, path resolved under the workspace; the only git call is `git show <ref>:<lockfile>` with the ref the user configured. | `action.test.ts` (invalid path → exit 3) |
| Summary comment used to inject Markdown or links from project data | Untrusted strings sanitized and Markdown-escaped; no links built from project data; comment and upload failures only warn. | `action.test.ts` summary escaping; "warns instead of failing when the comment cannot be posted" |
| Incomplete analysis silently passes in CI | Exit code 2 fails the job unless `allow-incomplete` is set, and the summary says so in both cases. | `action.test.ts` "incomplete fails by default and passes with allow-incomplete" |

### 9. Output

| Threat | Mitigation | Test |
|---|---|---|
| Package name, advisory summary or code snippet containing ANSI escapes or newlines spoofs a `GATE: PASS` line | `sanitize()` strips C0/C1 controls, DEL, U+2028/2029 and collapses newlines before any untrusted string is printed; values are truncated. | `cli.test.ts` "strips control characters", "renders an untrusted summary without letting it break lines" |
| Attacker-controlled URL in `ref:` or in an advisory source is auto-opened | Nothing is opened; URLs are printed as text only. | By construction |
| Report strings inject PDF syntax (close a string, add operators, actions, JavaScript or links) in the downloaded PDF | Own writer (`src/report/pdf.ts`), no dependency: every string goes through `sanitize()`, is mapped to WinAnsi and has the backslash and both parentheses escaped; the file has no annotations, actions or scripts; URLs are plain text. | `pdf.test.ts` "never lets report strings escape the text string they are drawn in", "writes a structurally valid PDF …" (no `/JavaScript`, `/OpenAction`, `/URI`), "contains no full credential from the scanned project" |

### 10. Language and interpretation

| Threat | Mitigation | Test |
|---|---|---|
| User reads `pass` as "secure" | Fixed wording: "No known vulnerabilities or insecure patterns were found in the sources consulted." Every report carries `analyses` and `limitations`. | `cli.test.ts` asserts the wording and the absence of "secure/safe/free of" as words |
| Pattern rules with unmeasured precision block builds | Pattern findings are `warn` by default and only gate with `--patterns gate`; precision on real projects is tracked in `docs/VALIDATION_SPRINT_1.md`. | `patterns.test.ts` "gate mode counts pattern findings in the verdict"; `cli.test.ts` warn vs gate |
| Invented findings | Dependency findings come only from OSV records, copied verbatim; pattern findings cite file, line and a redacted snippet. | `osv.test.ts`, `priority.test.ts`, `patterns.test.ts` |
| AI layer takes action | No AI exists in this version. `aiExplanation` is reserved and always `null`. | `cli.test.ts` asserts `aiExplanation === null` |
| The fix prompt becomes an injection vector into the user's AI coding tool (a crafted file, variable, table or package name carrying instructions) | Prompts are written per rule and filled only with finding facts; each value passes a strict allowlist (`src/rules/remediation/safe.ts`: paths, identifiers, table and package names, versions), anything else becomes "?"; matched code is never quoted; every prompt ends with a fixed paragraph that forbids weakening checks or printing secrets; supply-chain findings get no prompt. | `remediation.test.ts` "neutralizes crafted paths and names", "filters crafted package names and versions", "never quotes the matched code", "never suggests silencing the check", "contains no full credential" |
| A project with only a pnpm, Yarn or Bun lockfile reads as `pass` | Those lockfiles are detected at the root; alone they make `analyses.dependencies` `not-supported` and the verdict `incomplete`. | `scan.test.ts` "unsupported lockfiles" |

### 11. Hosted service (Sprint 4)

| Threat | Mitigation | Test |
|---|---|---|
| Hostile URL reaches the network (other hosts, credentials in the URL, ports, IPs, `javascript:`, look-alike Unicode) | Fixed grammar for `https://github.com/<owner>/<repo>[/tree/<ref>]` only, 300-character cap, checked before any request; the refusal never echoes the input. | `web.test.ts` "parseGitHubRepoUrl" accept/reject tables, "never leaks the input back in the reason", "stays fast on adversarial input (ReDoS budget)" |
| Archive writes outside its directory (absolute paths, `..`, PAX or GNU long-name traversal, symbolic or hard links) | Own tar reader, no dependency: only regular files and directories are written; an unsafe path (including a link's own name) rejects the whole archive; symbolic and hard links with safe names are skipped, never created or followed, and listed as "not read" in the report (since 2026-10-30, PO decision after 4 of 10 validation repositories were refused for links); nothing is left behind. | `web.test.ts` "refuses … and writes nothing outside the destination" (table, incl. "link with a traversal name"), "skips symbolic and hard links without creating anything, and lists them", "analyzes a repository that contains links and says which ones were not read" |
| Decompression bomb, huge repository or slow download exhausts the function | 50 MB compressed, 200 MB uncompressed, 20,000 entries, 8 MB per file, 120 s total; above any of them the analysis is refused or marked incomplete, never `pass`. | `web.test.ts` "refuses an archive that expands past the uncompressed limit", "refuses more entries than allowed", "honours the total timeout" |
| Anything from the repository is executed | No git, no package manager, no child process: bytes become files and the engine reads them as text. | By construction (`src/web/service.ts`, `tar.ts`) |
| Quota abuse (OSV, Vercel, GitHub API) | Sign-in required for scans; 10 analyses per user per hour claimed atomically in Postgres (`claim_scan`) before any download; reuse of a report of the same commit for 24 h without spending quota; a store outage answers 503 instead of scanning unmetered. | `web-handler.test.ts` "answers 429 … before any download", "scans once … reuses it for the same commit without spending quota", "answers 503 when the store is unreachable" |
| Sign-in misconfigured in production opens anonymous scans | Functions fail closed: with `requireAuth` and no auth configured, every scan is refused. | `web-handler.test.ts` "fails closed when auth is required but not configured" |
| Forged or foreign session | Bearer token checked with Supabase Auth on every call; malformed tokens never leave the server; unknown tokens get 401. | `web-handler.test.ts` "treats 401, malformed bodies, odd logins and network failures as no user", "never calls Supabase for a token that is not token-shaped" |
| Another user reads a saved report | Report ids are random UUID v4 (122 random bits), not enumerable; the store returns a report only to its owner (404 otherwise); the browser never talks to Supabase tables; RLS is on with no policies, so only the service key can read. | `web-handler.test.ts` "serves reports only to their owner", "scopes get by owner"; `supabase/migrations/` |
| A secret found in a scanned repository is stored | The saved report is the engine's JSON, already redacted; a test scans the fixture with synthetic credentials through the handler and checks the stored JSON. | `web-handler.test.ts` "saves a report without any full credential from the scanned project"; e2e "analyzes a public repository …" (page text) |
| Malicious package name or snippet rendered as HTML or a link in a shared report | React text nodes only; no links built from report content; strict CSP (`default-src 'self'`, no inline scripts, no third-party scripts), `Referrer-Policy: no-referrer` so the report id does not leak, `frame-ancestors 'none'`. | `web/vercel.json`; e2e redaction checks |
| Cleanup endpoint abused | `/api/cron/cleanup` requires `CRON_SECRET` as a bearer token. | `web-handler.test.ts` "requires the cron secret …" |
| Keys leak from the repository or the page | Service key only in Vercel environment variables; the page receives only the publishable key, which RLS makes useless for table access. | `web-handler.test.ts` env tests; `docs/DEPLOY.md` |

## Residual risks

- A dependency that is vulnerable but not yet in OSV yields `no-known-vulnerabilities`.
- Supply-chain compromises that keep the version number are detected only once a reviewer has approved a record about them; the curated set is as good as its sources and reviewers.
- Pattern rules miss anything expressed indirectly (configuration through variables, SQL outside migrations, secrets without a recognisable prefix) and may misclassify files in unconventional layouts.
- A `pass` is a statement about the sources and rules at scan time only.
- Priority does not account for reachability or for how the application is deployed.
- Hosted: a determined abuser with many GitHub accounts can multiply the per-user quota; the anonymous GitHub API limit (60 requests per hour per server IP) is shared by every user until a read-only token is configured.
- Hosted: whether the curated advisory set is bundled into the Vercel function is checked after each deploy (`docs/DEPLOY.md` §7); when missing, the report says so, but the page then consults OSV only.
- Agent configuration rules (GSK-AGENT-*) see only what is committed: personal, gitignored settings (`.claude/settings.local.json`) and global agent configuration on a developer's machine are out of reach, and strict-JSON files (`.mcp.json`, `.claude/settings.json`) cannot carry an inline suppression.
- Hosted: scan history and notifications live in the browser (`localStorage`) and are lost on another device; they hold no secrets, only repository names and counts.

# Gateseeker — Roadmap proposal (Sprint 4 → 9, plus Track A)

> Status: written 2026-10-28; **decisions 1, 2 and 7 (A1) approved by the PO on 2026-10-28** (§5), the rest still a proposal. Continues `docs/PRODUCT.md` §7, which covers Sprints 0 to 4. Nothing here starts without approval; the items that need new services, dependencies or GitHub integration are listed in §5 (rule 8 of `CLAUDE.md`).

## 1. Where we are

The engine is complete and validated: npm and Composer lockfiles, OSV + Packagist, a curated advisory feed collected every 6 hours with human approval, structural supply-chain rules, AI-code pattern rules, a GitHub Action with SARIF, and a web workspace behind GitHub login.

The product today answers one question well: **"what is wrong with this repository right now?"** What it does not do yet is what our audience needs most: **help them fix it, and tell them when something new affects them.** A vibe coder does not come back to run a scan. Threats appear daily; our user has to hear about the new one without asking.

## 2. UX problems observed in the current product

| # | Problem | Where | Why it matters for our audience |
|---|---|---|---|
| U1 | **The demo is behind login.** Sprint 4's hypothesis is "value in one minute without installing anything", and principle 7 says "no account to start". Login was added afterwards to protect the quota. | `/app` | Every extra step before the first report loses people who have never heard of the product. |
| U2 | **The report says what is wrong, not how to fix it in *their* tool.** `remediation.action` is one generic sentence. Our user fixes things by asking Cursor/Lovable/Claude Code to do it. | `views/Report.tsx` | A P1 they don't know how to fix is a P1 they ignore, exactly like the Dependabot alerts we said they ignore. |
| U3 | **History and notifications live in `localStorage`.** Another browser or a cleared cache starts empty; the service has no "my reports" list. | `web/src/history.ts`, `notifications.ts` | The Dashboard looks broken on a second device. Users can't trust a history that disappears. |
| U4 | **No "what changed since last time".** Each scan is a fresh list; baseline exists in the CLI but not on the web. | Workspace | After fixing three things, the user can't see progress, and a new problem gets lost among the old ones. |
| U5 | **No way to say "I know, accept this".** Suppression exists only as a code comment (`gateseeker-ignore`). | Report | Accepted risks come back every scan. That noise is how people stop reading reports. |
| U6 | **The hosted scan may not consult the curated feed** (`src/web/service.ts` relies on `dist/advisories.json` being traced into the Vercel function; not verified on the live page. The failure is not silent: the report then shows origin `none` and a limitation, so the check is in `docs/DEPLOY.md` §7). New approved records reach users only after a redeploy. | `src/web/` | The feed is our differentiator; if the page doesn't use it, the page undersells the product. |
| U7 | **Lockfile coverage gap:** only `package-lock.json` and `composer.lock`. Projects using pnpm, Yarn or Bun get no dependency analysis. | `src/parser/` | Lovable, Bolt and many Next.js templates use Bun or pnpm. Today they get a partial report, possibly without realizing it. |
| U8 | **Dense language for non-specialists.** P1–P4, CVSS, "GHSA", "advisory" are expert vocabulary. | Report, CLI | Our user isn't a security person. They need "Fix today / This week / When you can / FYI" and one plain sentence of impact. |

## 3. Roadmap

Each sprint keeps the format of `PRODUCT.md`: delivery, the hypothesis it tests, the metric.

### Sprint 4 (finish) — Ship the page honestly
- Publish with Supabase + OAuth configured (`docs/DEPLOY.md`), round 2 validation through the live page.
- **U6:** in round 2, confirm the report's sources line shows `gateseeker-advisories: bundled (N approved …)`; if it shows `none`, add the file to the function bundle (`includeFiles` in `vercel.json`).
- **U1 (decision for the PO):** let anonymous visitors scan without logging in, with a stricter limit (for example 3 per IP per day). Saved reports and history stay behind login. Alternative: keep login but show the example report on Home as the hero.
- **U7, minimum:** when a repo has `pnpm-lock.yaml`, `yarn.lock` or `bun.lock` but no supported lockfile, the verdict says so explicitly ("dependencies not analyzed: pnpm lockfile not supported yet"). This is honesty, not a feature.

*Metric:* unchanged from Sprint 4.

### Sprint 5 — From finding to fix
Detailed scope, with Track A1, in `docs/SPRINT_5.md` (approved 2026-10-29). Note: the web already uses plain priority labels ("Fix now", "Fix before release", …), so U8 there reduces to the impact sentence and the same labels in the CLI and the Action.

- **U2, "Fix with your AI tool":** each finding gets a copyable, deterministic fix prompt written per rule ("In `src/lib/supabase.ts`, the service-role key is exposed through `NEXT_PUBLIC_…`. Move it to a server-only variable and …"). The templates are written by us and tested like rules; no LLM generates them. A short manual fix is also shown for people who don't use AI tools.
- **U8, plain language:** priorities renamed in the UI to *Fix today / This week / When you can / For your information* (P-codes stay as a secondary label and in JSON/SARIF). One "what could happen" sentence per rule.
- **U5, accept risk:** "Accept this finding" on the web writes a suggested `gateseeker-ignore` line with a reason, to paste into the code. The decision stays in the repository, reviewable in the PR, with no server state.
- **U7:** `pnpm-lock.yaml` and `yarn.lock` parsers (Zod-validated, fixtures from real projects). Bun only if its text lockfile is stable.

*Hypothesis:* people fix more when the fix is one paste away. *Metric:* among users who scan the same repo twice, ≥30% have fewer P1+P2 findings on the second scan.

### Track A (parallel to Sprints 5–6) — Coding agents as a risk surface
Claude Code, Cursor, Codex and similar agents don't only write code: they run commands, install packages and edit project configuration. Their code flaws are already covered by our rules, whoever wrote the code. Their **agent** flaws are not, and none of the competitors we track checks them. This track adds them in two steps.

**A1: agent configuration rules (no new service).** These are new pattern rules, built under the same rules as every other one: positive, negative and suppression fixtures, a ReDoS timing test, warn mode by default, precision measured on real repositories before any rule can block (gate mode).

| Candidate rule | What it flags | Files |
|---|---|---|
| GSK-AGENT-001 | Unrestricted command permission (e.g. `Bash(*)`, `"allow": ["*"]`, auto-approve all) | `.claude/settings.json`, `.cursor/`, `.codex/` and equivalents |
| GSK-AGENT-002 | A hook that downloads and runs remote code (`curl … \| sh`, `npx <package>@latest`) | agent hook configuration |
| GSK-AGENT-003 | An MCP server started from an unpinned or remote source, or with secrets inline instead of environment variables | `.mcp.json`, editor MCP configs |
| GSK-AGENT-004 | Hidden instructions in files agents read: invisible Unicode, HTML comments or encoded text in instruction files | `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md` |
| GSK-AGENT-005 | Safety nets weakened in config: commit-check bypass (`--no-verify`) in scripts or hooks, tests excluded or `skip`ped in CI config | `package.json` scripts, CI workflows, hook config |

Most findings report a configuration, not a vulnerability. The wording says what the setting allows and why it matters ("any command the agent decides to run executes without asking you"). It never claims an attack happened.

**A2: packages that don't exist ("slopsquatting").** AI tools sometimes invent package names, and attackers register those names in advance with malicious code. For each dependency, check the public npm registry and Packagist: package created very recently, very low downloads, a name close to a popular package, or a package that is in the lockfile but not in the registry. The result is a `supply-chain-anomaly` finding with the registry data as evidence. It needs a new external source (the npm registry), so it waits for PO approval; it ships with the same limits, injected `fetch` in tests and `incomplete` on failure as the OSV client.

**A3: Gateseeker inside the agent loop (Sprint 9 candidate, listed here for continuity).** A ready-made hook so Claude Code (and others that support hooks) runs the gate before committing, and blocks on a P1. Hooks run commands on the user's machine, so this is documented as an opt-in snippet; Gateseeker doesn't install it by itself.

*Hypothesis:* vibe coders don't know their agent configuration is a risk, and they change it when told in plain words. *Metric:* among scanned repositories with an agent config file, at least one A1 finding in ≥20%, and ≥5 users who change a setting after seeing one (measured by a later scan of the same repository).

### Sprint 6 — The product watches for you
This is the direct answer to "threats appear daily".
- **U3:** server-side history: "my repositories" and "my reports" in Supabase (RLS, no policies, service_role only, as today). `localStorage` becomes a cache.
- **U4, compare:** each rescan of a repo shows *new / fixed / still open* against the previous one, reusing the CLI baseline logic.
- **Continuous monitoring:** the user follows a repo. The service rescans it (a) when a new advisory is approved in the feed, and (b) weekly, because OSV changes. When something **new** appears, they get one email: "A new issue affects `owner/repo`: …, fix today." Only new findings trigger an email, never the full list again.
- **U6, feed without redeploy:** approved advisories are published to storage on merge, and the service reads the current set (signed or checksummed), so a record approved today protects everyone today.

*Hypothesis:* being told is worth more than remembering to ask. *Metric:* 30 followed repositories; ≥40% of monitoring emails lead to a visit to the report.

### Sprint 7 — Private repositories and the first paid plan
- GitHub App with read-only, per-repository permission to scan private repos (the only way most real client projects can be scanned).
- Pull-request check from the App: no YAML needed. Install it, choose repos, done. This is the easy path for people who will never edit a workflow file.
- First paid plan (open core, as in `PRODUCT.md` §8): private repos, monitoring, history beyond 30 days. The free tier keeps public scans, the CLI and the Action.

*Hypothesis:* someone pays to have a private client project watched. *Metric:* 10 paying accounts.

### Sprint 8 — Agencies and small teams
- Workspaces with several members; a "client report" view (PDF already exists) with the agency's name, for freelancers to hand to clients.
- Gate policy per workspace (which priorities block, which rules are in gate mode), edited on the web and enforced by the Action.

*Hypothesis:* agencies use Gateseeker as a deliverable to their clients. *Metric:* 5 workspaces with ≥3 members or ≥5 client repos.

### Sprint 9 and later (candidates, decided with data)
- Optional AI **explanation** of a finding (the third layer of `Finding`, always labeled, never decisive). Paid service, needs approval.
- Generic secret detection (the gap recorded in `VALIDATION_SPRINT_1.md`), with its own precision budget.
- More pattern rules for Firebase and Next.js server actions, prioritized by what the monitoring data shows is common.
- Editor/agent integration: an MCP server or extension so Cursor/Claude Code can run the gate before the user commits (starts with the hook in Track A3).

## 4. Principles that do not change

Everything above keeps the non-negotiables: deterministic priority, `incomplete` never shown as `pass`, no "secure" language, nothing from the analyzed project executed, secrets redacted everywhere, including monitoring emails, and every pattern rule shipped with fixtures and measured precision.

## 5. Decisions needed from the PO

Approved by the PO on 2026-10-28: **1** (keep login and measure), **2** (Sprint 5 before Sprint 6), **7** (Track A1 now; A2 waits). On 2026-10-29: **5** (pnpm and Yarn are not a new ecosystem; Sprint 5 reads them) and the Sprint 5 scope. Open: 3, 4, 6, and the A2 source.

1. **Anonymous scans on the page (U1):** reopen, with a stricter limit, or keep login? Recommendation (revised 2026-10-28): **launch with login and measure.** Our audience already has a GitHub account, so sign-in is one click; Home shows a real example report so the value is visible before login; and two aggregate counters (visits to `/login`, completed sign-ins) tell us the abandonment rate. If more than 40% of visitors abandon at login over the first 2 weeks or 100 visits, open anonymous scans: 3 per IP per day, a global daily cap, report shown but not saved, "sign in to save and follow this repo" as the next step.
2. **Order:** Sprint 5 (fix) before Sprint 6 (monitoring)? Recommendation: yes. Monitoring sends people to reports, so the reports must first tell them how to fix.
3. **Email provider for monitoring (Sprint 6):** a new paid/hosted service (for example Resend or Postmark, free tiers available). Needs approval.
4. **GitHub App (Sprint 7):** this is "GitHub integration" under rule 8 and needs explicit approval, plus a security review of the App's permissions.
5. **pnpm/Yarn support (Sprint 5):** these are new lockfile formats within an existing ecosystem. Confirm whether this counts as a "new ecosystem" under rule 8.
6. **Pricing:** to be set before Sprint 7, informed by the Sprint 4 waitlist answers.
7. **Track A:** approve A1 (rules only, no new service) to start alongside Sprint 5? Approve the npm registry as a new external source for A2? Recommendation: A1 yes; A2 after A1 shows that the audience cares.

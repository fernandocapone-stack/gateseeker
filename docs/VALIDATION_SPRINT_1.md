# Sprint 1 validation on real projects

> Date: 2026-10-27. Gateseeker commit: see git log for "Sprint 1 validation". Pattern analysis only (`--only patterns`); dependency analysis was covered by Sprint 0.
> Approved by the PO: cloning the five public repositories below into an isolated scratch directory, scanning them, classifying every finding by hand, recording the result here. No code was redistributed, the clones and reports were deleted afterwards, and no real secret value is recorded in this document.

## Sample

| # | Repository (public GitHub) | Commit | Generator | Why it was chosen |
|---|---|---|---|---|
| 1 | eduardogil1801/tacom-equipamentos-controle-web | `4ab3b50` | Lovable (`lovable-tagger`) | 46 Supabase migrations, committed `.env`, active in 2026-09. |
| 2 | francisco-dev-ao/projectofinalah | `5075c6b` | Lovable | 30 Supabase migrations, 30 edge functions, Next.js. |
| 3 | josephkamau32/LinguaLearn | `f1cc2e2` | Lovable | Most-starred Lovable candidate with migrations and committed `.env`. |
| 4 | donvito/bolt-newsletter-supabase | `26c27a7` | Bolt / StackBlitz | Second generator; small Vite + Express project. |
| 5 | dilums/v0-task-manager | `68dd48b` | v0 (Vercel) | Third generator; Next.js, exercises `next.config` rules. |

None of the repositories declares a license. They were read and analyzed locally only.

## Results per project

Counts after the rule adjustments described below (the first run is in the "What changed" section).

| Project | Files scanned | Findings | P1 | P3 | Rules that fired |
|---|---|---|---|---|---|
| tacom-equipamentos-controle-web | 242 | 2 | 0 | 2 | CORS-001 (2) |
| projectofinalah | 596 | 37 | 6 | 31 | SECRET-002 (3), SUPABASE-001 (3), CORS-001 (31) |
| LinguaLearn | 165 | 5 | 0 | 5 | CORS-001 (5) |
| bolt-newsletter-supabase | 21 | 0 | 0 | 0 | none |
| v0-task-manager | 85 | 2 | 0 | 2 | BUILD-001 (2) |

Every scan completed in well under a second of rule time; no walker limit was hit (largest project: 596 text files).

## Manual classification

Each finding was opened in the source and classified as **TP** (true positive: the described condition is present and the stated risk applies), **TP-info** (condition present, risk limited; severity LOW is appropriate) or **FP** (condition absent or rule misread the code). True negatives worth recording are listed too, because they are the evidence that a rule stays quiet when it should.

### GSK-SECRET-002 — server secret exposed through a public env prefix

| Where | Class | Verdict | Notes |
|---|---|---|---|
| projectofinalah `app/api/email/EmailService.ts:17` | server | **TP** | `NEXT_PUBLIC_SMTP_PASSWORD` read with a hardcoded fallback literal. The prefix inlines the real value into the browser bundle at build time. |
| projectofinalah `src/scripts/test-smtp.js:17` | server | **TP** | Same variable and fallback. |
| projectofinalah `src/components/admin/SMTPConfigurationForm.tsx:86` | client | **TP** | Client component writes the SMTP password to `localStorage` under that key. |
| projectofinalah `.env.local.example:6` (first run only) | env | removed | Example file; now excluded by the rule. The variable is still reported from the three code locations above. |

Precision on this sample: **3/3**.

### GSK-SUPABASE-001 — table without Row Level Security

| Where | Verdict | Notes |
|---|---|---|
| projectofinalah `supabase/migrations/20250521000000_create_comprehensive_tables.sql:137` (`public.companies`) | **TP** | Grep over all 30 migrations finds no `enable row level security` for this table. |
| same file `:152` (`public.customers`) | **TP** | Idem. Customer records readable and writable with the anon key. |
| same file `:165` (`public.payment_methods`) | **TP** | Idem. Payment method data without RLS. |

True negatives: tacom (5 `create table`, 20 `enable row level security`), LinguaLearn (7 / 8) and the other 29 tables of projectofinalah produced no finding. Precision: **3/3**.

### GSK-CORS-001 — wildcard CORS origin

38 findings across tacom (2), projectofinalah (31) and LinguaLearn (5). All are `Access-Control-Allow-Origin: *` without any credentials in the same file: 37 in `supabase/functions/*/index.ts`, which is the header block the Supabase Edge Function template ships by default, and one in projectofinalah `next.config.js`.

Verdict: **38 TP-info, 0 FP**. The condition is real, but a wildcard without credentials does not let a third-party site act as the user (no cookies are sent), so it does not deserve P2 and must not block builds. The rule's base severity was lowered from MODERATE to LOW (see below). With credentials present the severity remains HIGH, as the synthetic fixture exercises.

### GSK-BUILD-001 — build ignores type or lint errors

v0-task-manager `next.config.mjs:4` and `:7`: `ignoreDuringBuilds: true` and `ignoreBuildErrors: true`. **2/2 TP.**

### Rules that did not fire

| Rule | Status on this sample | Evidence it stayed quiet correctly |
|---|---|---|
| GSK-SECRET-001 | **Not exercised** (0 findings, precision unmeasured). | Independent sweep for AWS, Stripe live, GitHub, OpenAI, Anthropic, Slack, PEM and Google key formats found no occurrence in any project, so no false negative of a supported format. Five JWTs were found (`.env` files and Supabase client files); all decode to role `anon`, which is public by design and correctly not reported. |
| GSK-SUPABASE-002 | **Not exercised.** | LinguaLearn references `SERVICE_ROLE` in a root `create-tables.js` script, `docker-compose.yml` and a README; none is client code, none was reported. |
| GSK-FIREBASE-001 | **Not exercised.** | No project uses Firebase. |
| GSK-ENV-001 | **Not exercised**, with two meaningful true negatives. | tacom and LinguaLearn both commit a `.env` that is not in `.gitignore`, but every variable in them is a public `VITE_*` value (URL, anon key, project id). The rule correctly stayed silent because it requires at least one non-public variable. |

## What changed because of this validation

1. **A real secret reached a snippet (defect, fixed).** The first run of `GSK-SECRET-002` printed the whole source line, which in projectofinalah contained a hardcoded fallback password next to the environment variable. That violated the rule that no secret value ever appears in a report. Fix: `maskQuotedLiterals()` now hides every quoted literal of eight or more characters in snippets of `GSK-SECRET-002` and `GSK-SUPABASE-002`; a fixture (`lib/mailer.ts`) and a test assert the literal is absent from the JSON and the terminal output. The scratch reports produced before the fix were overwritten and then deleted.
2. **`GSK-CORS-001` severity.** Base severity lowered from MODERATE to LOW when no credentials are enabled in the file (P3, never gated by the default `--fail-on P2`). HIGH with credentials is unchanged. Rationale in the rule's header comment and in README.
3. **Example dotenv files.** `.env.local.example`, `.env.production.sample` and similar are now treated as examples by `GSK-SECRET-001`, `GSK-SECRET-002` and `GSK-ENV-001` (previously only `.env.example`).

## Observed gap (not fixed, recorded)

The hardcoded fallback password in projectofinalah is a real secret that no rule reports: it has no provider prefix, so `GSK-SECRET-001` cannot see it, and `GSK-SECRET-002` only reports the variable name. Generic "high-entropy literal assigned to a password-like key" detection is a candidate for a later sprint, with its own precision budget.

## Precision summary and gate eligibility

| Rule | Findings | TP | FP | Precision | Eligible for `--patterns gate` |
|---|---|---|---|---|---|
| GSK-SECRET-002 | 3 | 3 | 0 | 100% (n=3) | yes |
| GSK-SUPABASE-001 | 3 | 3 | 0 | 100% (n=3) | yes |
| GSK-CORS-001 | 38 | 38 (info) | 0 | 100% (n=38) | yes (LOW; only gates at `--fail-on P3`) |
| GSK-BUILD-001 | 2 | 2 | 0 | 100% (n=2) | yes (LOW) |
| GSK-SECRET-001 | 0 | – | – | unmeasured | fixture-tested only |
| GSK-SUPABASE-002 | 0 | – | – | unmeasured | fixture-tested only |
| GSK-FIREBASE-001 | 0 | – | – | unmeasured | fixture-tested only |
| GSK-ENV-001 | 0 | – | – | unmeasured (2 true negatives) | fixture-tested only |

No rule fell below the 90% bar, so none is marked `experimental`. Four rules were not exercised by this sample; their precision on real code is unknown and they remain in the default warn mode like every other rule. The sample sizes are small; this is evidence of plausibility, not a statistical claim.

## Still pending from the Sprint 1 hypothesis

The hypothesis also asked whether developers of such projects would act on the findings ("at least 3 of 5 say they would fix something"). That requires contacting the authors and was not part of this engineering validation; it is the PO's call whether and how to do it.

## Reproduction

```bash
git clone --depth 1 https://github.com/<owner>/<repo>.git /tmp/gs-validation/<repo>
```

```bash
node dist/cli.js scan /tmp/gs-validation/<repo> --only patterns --format json --output /tmp/gs-validation/<repo>.report.json
```

Commits listed in the sample table pin the exact trees that were analyzed.

## Re-run on 2026-10-31: mentions are not uses

Change under test: `GSK-SECRET-002` and `GSK-SUPABASE-002` no longer count a variable name that only appears inside a sentence in quotes or inside a regular expression, in JavaScript/TypeScript files (`src/patterns/code-text.ts`). The trigger was Gateseeker's own repository: its rule definitions and its Resources page mention these names and were reported as P1.

The five repositories above were cloned again at the same commits and scanned with `--only patterns`, once with the build of `main` and once with the change. The findings are identical in all five (2, 37, 5, 0 and 2), including the three `GSK-SECRET-002` true positives in projectofinalah. The sample has no mention-only case, so the change is covered by the fixture `fixtures/projects/vibe-next-supabase/components/HelpText.tsx` (three mentions not reported, two reads in a template literal and in JSX still reported). The clones and reports were deleted afterwards.

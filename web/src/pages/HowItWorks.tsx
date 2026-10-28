import { Card, CardContent, CardHeader, CardTitle } from "@gateseeker/ui-kit";

import { PageIntro } from "../components/PageIntro";
import { Link } from "../router";

const STEPS: { title: string; text: string }[] = [
  { title: "Read, never run", text: "Gateseeker takes a project directory, a lockfile, or (here) the archive of a public GitHub repository. It reads files as text. It never installs dependencies, never executes scripts, never runs git. A malicious project cannot attack the tool that analyzes it." },
  { title: "Ask the sources", text: "Every installed npm or Composer version is queried against OSV, the open vulnerability database, and against a curated advisory feed that Gateseeker maintains for incidents the official databases miss, such as tag rewrites on Packagist. Packagist is consulted to verify those. Every source and query time is recorded in the report." },
  { title: "Look for the usual mistakes", text: "Eight code-pattern rules target what AI-generated apps actually ship: credentials with a known provider format, Supabase service keys and disabled row-level security, Firebase config, open CORS with credentials, committed .env files, debug builds. Each rule ships with positive, negative and suppression fixtures and starts in warn mode." },
  { title: "Rank with rules you can read", text: "Each finding gets a priority from P1 (fix now) to P4 (keep an eye on it), computed from a published table: severity, whether the dependency is direct and used in production, whether a fix exists. The rationale is printed next to every finding. No language model decides whether a problem exists or how urgent it is." },
  { title: "Decide", text: "The result is a verdict: pass, fail, or incomplete. Incomplete means a query failed or a dependency could not be checked, and it is never reported as clean. In CI, the verdict is the exit code; the pull request gets a comment and SARIF results in the Security tab." },
];

const LAYERS: { title: string; text: string }[] = [
  { title: "Evidence", text: "What the source or the file says, untouched: the advisory record, the line of code (with secrets redacted), the lockfile entry." },
  { title: "Rule conclusions", text: "Severity, priority, the rules applied in order, and the concrete action. Reproducible from the evidence and the published tables." },
  { title: "Explanation (reserved)", text: "A slot for an optional AI-written explanation in a future version. It will never create, remove or re-rank a finding." },
];

export function HowItWorks() {
  return (
    <>
      <PageIntro title="How it works" lead="Five steps, all deterministic, all auditable. The same engine runs on this page, in the CLI, and in the GitHub Action." />

      <ol className="relative mb-14 ml-4 grid gap-8 border-l border-border pl-8 sm:ml-5 sm:pl-10">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative">
            <span className="absolute -left-[calc(2rem+1.0625rem)] top-0 flex size-8 items-center justify-center rounded-full border border-primary-stroke bg-primary text-sm font-semibold text-primary-foreground shadow-solid [--shadow-color:var(--primary-stroke)] sm:-left-[calc(2.5rem+1.0625rem)]" aria-hidden="true">
              {i + 1}
            </span>
            <h2 className="text-lg font-semibold leading-8 tracking-tight">{s.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>

      <section className="mb-10">
        <Card>
          <CardHeader>
            <CardTitle>The three layers of a finding</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 text-sm sm:grid-cols-3">
            {LAYERS.map((l, i) => (
              <div key={l.title}>
                <p className="mb-1 font-mono text-xs text-primary">0{i + 1}</p>
                <h3 className="font-medium">{l.title}</h3>
                <p className="mt-1 text-muted-foreground">{l.text}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <p className="text-sm text-muted-foreground">
        Want the exact rule tables and limits? See <Link href="/resources" className="text-primary hover:underline">Resources</Link>. Ready to run it? <Link href="/get-started" className="text-primary hover:underline">Get started</Link>.
      </p>
    </>
  );
}

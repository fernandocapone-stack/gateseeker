import { Card, CardContent, CardHeader, CardTitle } from "@gateseeker/ui-kit";

import { Link } from "../router";

const STEPS: { title: string; text: string }[] = [
  { title: "1. Read, never run", text: "Gateseeker takes a project directory, a lockfile, or (here) the archive of a public GitHub repository. It reads files as text. It never installs dependencies, never executes scripts, never runs git. A malicious project cannot attack the tool that analyzes it." },
  { title: "2. Ask the sources", text: "Every installed npm or Composer version is queried against OSV, the open vulnerability database, and against a curated advisory feed that Gateseeker maintains for incidents the official databases miss, such as tag rewrites on Packagist. Packagist is consulted to verify those. Every source and query time is recorded in the report." },
  { title: "3. Look for the usual mistakes", text: "Eight code-pattern rules target what AI-generated apps actually ship: credentials with a known provider format, Supabase service keys and disabled row-level security, Firebase config, open CORS with credentials, committed .env files, debug builds. Each rule ships with positive, negative and suppression fixtures and starts in warn mode." },
  { title: "4. Rank with rules you can read", text: "Each finding gets a priority from P1 (fix now) to P4 (keep an eye on it), computed from a published table: severity, whether the dependency is direct and used in production, whether a fix exists. The rationale is printed next to every finding. No language model decides whether a problem exists or how urgent it is." },
  { title: "5. Decide", text: "The result is a verdict: pass, fail, or incomplete. Incomplete means a query failed or a dependency could not be checked, and it is never reported as clean. In CI, the verdict is the exit code; the pull request gets a comment and SARIF results in the Security tab." },
];

export function HowItWorks() {
  return (
    <>
      <section className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">How it works</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Five steps, all deterministic, all auditable. The same engine runs on this page, in the CLI, and in the GitHub Action.</p>
      </section>
      <ol className="mb-10 grid gap-4">
        {STEPS.map((s) => (
          <li key={s.title}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{s.text}</CardContent>
            </Card>
          </li>
        ))}
      </ol>
      <section className="mb-10">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The three layers of a finding</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <h3 className="font-medium">Evidence</h3>
              <p className="text-muted-foreground">What the source or the file says, untouched: the advisory record, the line of code (with secrets redacted), the lockfile entry.</p>
            </div>
            <div>
              <h3 className="font-medium">Rule conclusions</h3>
              <p className="text-muted-foreground">Severity, priority, the rules applied in order, and the concrete action. Reproducible from the evidence and the published tables.</p>
            </div>
            <div>
              <h3 className="font-medium">Explanation (reserved)</h3>
              <p className="text-muted-foreground">A slot for an optional AI-written explanation in a future version. It will never create, remove or re-rank a finding.</p>
            </div>
          </CardContent>
        </Card>
      </section>
      <p className="text-sm text-muted-foreground">
        Want the exact rule tables and limits? See <Link href="/resources" className="text-primary hover:underline">Resources</Link>. Ready to run it? <Link href="/get-started" className="text-primary hover:underline">Get started</Link>.
      </p>
    </>
  );
}

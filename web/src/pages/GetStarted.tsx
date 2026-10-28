import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { Globe, Terminal } from "lucide-react";

import { CiSnippet } from "../components/CiSnippet";
import { Link } from "../router";

export function GetStarted() {
  return (
    <>
      <section className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Get started</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Three ways to run the same engine. Pick the one that matches where you are: curious, at the terminal, or about to merge.</p>
      </section>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="size-5 text-primary" aria-hidden="true" />
              1. In the browser, no install
            </CardTitle>
            <CardDescription>
              Paste the URL of a public GitHub repository in the <Link href="/login" className="text-primary hover:underline">demo workspace</Link> (free, rate limited). You get the full report in under a minute for most projects. Public repositories only, up to 50 MB compressed.
            </CardDescription>
          </CardHeader>
          <CardContent className="hidden" />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="size-5 text-primary" aria-hidden="true" />
              2. On your machine, any repository
            </CardTitle>
            <CardDescription>Needs Node 24. Nothing is installed from the analyzed project; the CLI only reads it.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md border bg-input p-4 font-mono text-xs leading-relaxed inset-shadow-solid"><code>{`npx gateseeker@beta scan .            # text report, exit code is the verdict
npx gateseeker@beta scan . --format json --output report.json
npx gateseeker@beta scan . --baseline base.lock   # compare with a previous lockfile`}</code></pre>
            <p className="mt-3 text-sm text-muted-foreground">
              Exit codes: 0 pass, 1 fail, 2 incomplete, 3 usage error. Every option is in the <Link href="https://github.com/gateseeker-dev/gateseeker#readme" className="text-primary hover:underline">README</Link>.
            </p>
          </CardContent>
        </Card>

        <CiSnippet />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What is next</CardTitle>
            <CardDescription>Accounts, history across runs, private repositories and team gate policies are on the roadmap. The engine, the rules and the Action stay open source. If you want one of those, tell us which on GitHub; the waitlist opens with the next release.</CardDescription>
          </CardHeader>
          <CardContent className="hidden" />
        </Card>
      </div>
    </>
  );
}

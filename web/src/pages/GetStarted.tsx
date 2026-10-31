import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { Globe, Terminal } from "lucide-react";
import type { ReactNode } from "react";

import { CiSnippet } from "../components/CiSnippet";
import { PageIntro } from "../components/PageIntro";
import { Link } from "../router";

export function GetStarted() {
  return (
    <>
      <PageIntro title="Get started" lead="Three ways to run the same engine. Pick the one that matches where you are: curious, at the terminal, or about to merge." />

      <div className="grid gap-6">
        <Step n={1} icon={<Globe aria-hidden="true" />} title="In the browser, no install">
          <CardDescription>
            Sign in with GitHub, paste the URL of a public GitHub repository and get the full report in under a minute for most projects. Free and rate limited; public repositories only, up to 50 MB compressed. <Link href="/login?next=/app" className="text-primary hover:underline">Open the workspace</Link>.
          </CardDescription>
        </Step>

        <Step n={2} icon={<Terminal aria-hidden="true" />} title="On your machine, any repository" description="Needs Node 24. Nothing is installed from the analyzed project; the CLI only reads it.">
          <pre className="overflow-x-auto rounded-md border bg-input p-4 font-mono text-xs leading-relaxed inset-shadow-solid"><code>{`npx gateseeker@beta scan .            # text report, exit code is the verdict
npx gateseeker@beta scan . --format json --output report.json
npx gateseeker@beta scan . --baseline base.lock   # compare with a previous lockfile`}</code></pre>
          <p className="mt-3 text-sm text-muted-foreground">
            Exit codes: 0 pass, 1 fail, 2 incomplete, 3 usage error. Every option is in the <Link href="https://github.com/gateseeker-dev/gateseeker#readme" className="text-primary hover:underline">README</Link>.
          </p>
        </Step>

        <CiSnippet />

        <Card>
          <CardHeader>
            <CardTitle>What is next</CardTitle>
            <CardDescription>Following a repository with an email when something new appears, private repositories and team gate policies are on the roadmap. The engine, the rules and the Action stay open source. Tell us what you need on GitHub.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </>
  );
}

function Step({ n, icon, title, description, children }: { n: number; icon: ReactNode; title: string; description?: string; children?: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/35 bg-primary/12 text-primary [&_svg]:size-5">{icon}</span>
        <div className="grid gap-1">
          <p className="font-mono text-xs text-primary">Step {n}</p>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
      </CardHeader>
      {children && <CardContent className="sm:pl-[4.75rem]">{children}</CardContent>}
    </Card>
  );
}

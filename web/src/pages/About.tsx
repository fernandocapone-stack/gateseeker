import { Card, CardContent, CardHeader, CardTitle } from "@gateseeker/ui-kit";

import { Link } from "../router";

export function About() {
  return (
    <>
      <section className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">About</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Gateseeker exists because software is now written faster than it is reviewed.</p>
      </section>

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Why</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground">
            <p>
              Tools like Lovable, Bolt, Cursor, v0 and Replit let a founder, a freelancer or a small studio ship a working product in days. None of them runs a security check on what they generate, and the people shipping with them usually do not have a security specialist, will not read a four-hundred-line report, and already ignore dependency alerts because nobody tells them which one matters.
            </p>
            <p>
              The result is predictable: keys in client bundles, databases exposed through disabled row-level security, open CORS, committed .env files, and dependencies that are vulnerable or, increasingly, malicious. Gateseeker is a gate for exactly that code: it finds the handful of findings that matter, explains why in one sentence each, and blocks the merge when they are serious.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where it started</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground">
            <p>
              In May 2026 the Laravel-Lang packages on Packagist had their release tags rewritten to point at malicious commits. Anyone who installed in the window got the payload; the official vulnerability databases had no record of it months later. That incident shaped two Gateseeker principles: supply-chain intelligence needs a curated, human-approved feed next to the official databases, and a tool that analyzes untrusted projects must never execute them.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What it is, and is not</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <h3 className="font-medium text-foreground">It is</h3>
              <p>A local, deterministic checker. It reads project files, consults public vulnerability sources, applies published rules, and returns prioritized findings with evidence, references and a verdict.</p>
            </div>
            <div>
              <h3 className="font-medium text-foreground">It is not</h3>
              <p>A penetration test, an infrastructure scanner, a runtime monitor, or an auto-fixer. It does not use AI to decide whether a vulnerability exists. It never says a project is "secure": only that no known vulnerabilities were found in the sources consulted.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open source, open data</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground">
            <p>
              The engine, the rules and the GitHub Action are MIT-licensed. The curated advisories are published under CC BY 4.0 and submitted upstream to OSV. Nobody in our audience installs a security tool they cannot read; so you can read all of it on{" "}
              <Link href="https://github.com/gateseeker-dev/gateseeker" className="text-primary hover:underline">GitHub</Link>.
            </p>
            <p>Accounts, history and private repositories are on the roadmap; the gate itself will stay open.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

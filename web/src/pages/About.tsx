import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@gateseeker/ui-kit";

import { PageIntro } from "../components/PageIntro";
import { Link } from "../router";

export function About() {
  return (
    <>
      <PageIntro title="About" lead="Gateseeker exists because software is now written faster than it is reviewed." />

      <div className="grid gap-12">
        <Section title="Why">
          <p>
            Tools like Lovable, Bolt, Cursor, v0 and Replit let a founder, a freelancer or a small studio ship a working product in days. None of them runs a security check on what they generate, and the people shipping with them usually do not have a security specialist, will not read a four-hundred-line report, and already ignore dependency alerts because nobody tells them which one matters.
          </p>
          <p>
            The result is predictable: keys in client bundles, databases exposed through disabled row-level security, open CORS, committed .env files, and dependencies that are vulnerable or, increasingly, malicious. Gateseeker is a gate for exactly that code: it finds the handful of findings that matter, explains why in one sentence each, and blocks the merge when they are serious.
          </p>
        </Section>

        <Section title="Where it started">
          <p>
            In May 2026 the Laravel-Lang packages on Packagist had their release tags rewritten to point at malicious commits. Anyone who installed in the window got the payload; the official vulnerability databases had no record of it months later. That incident shaped two Gateseeker principles: supply-chain intelligence needs a curated, human-approved feed next to the official databases, and a tool that analyzes untrusted projects must never execute them.
          </p>
        </Section>

        <Section title="What it is, and is not">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-success">It is</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">A local, deterministic checker. It reads project files, consults public vulnerability sources, applies published rules, and returns prioritized findings with evidence, references and a verdict.</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-destructive">It is not</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">A penetration test, an infrastructure scanner, a runtime monitor, or an auto-fixer. It does not use AI to decide whether a vulnerability exists. It never says a project is "secure": only that no known vulnerabilities were found in the sources consulted.</CardContent>
            </Card>
          </div>
        </Section>

        <Section title="Open source, open data">
          <p>
            The engine, the rules and the GitHub Action are MIT-licensed. The curated advisories are published under CC BY 4.0 and submitted upstream to OSV. Nobody in our audience installs a security tool they cannot read; so you can read all of it on{" "}
            <Link href="https://github.com/gateseeker-dev/gateseeker" className="text-primary hover:underline">GitHub</Link>.
          </p>
          <p>Accounts, history and private repositories are on the roadmap; the gate itself will stay open.</p>
        </Section>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t pt-8 sm:grid-cols-[12rem_1fr] sm:gap-8">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="grid max-w-2xl gap-4 text-base leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

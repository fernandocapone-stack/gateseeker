import { Card, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { ArrowRight, ListOrdered, ScanSearch, Siren } from "lucide-react";
import type { ReactNode } from "react";

import { ExampleReport } from "../components/ExampleReport";
import { Link } from "../router";

/**
 * Marketing Home: hero, an illustrative (static) report, the three pillars and
 * the two calls to action. The live "paste a URL" analysis is not here on
 * purpose: it lives in the demo workspace (/app), behind sign-in once accounts exist.
 */
export function Home() {
  return (
    <>
      <section className="mb-12">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">Security gate for AI-generated code</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your app was built fast. Find out what shipped with it.</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Gateseeker reads your repository (never runs it), checks the installed dependencies against OSV and a curated advisory feed, looks for the insecure patterns common in vibe-coded apps, and ranks every finding with explainable rules.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href="/get-started" className="inline-flex h-11 items-center gap-2 rounded-md border border-primary-stroke bg-primary px-6 text-sm font-medium text-primary-foreground shadow-solid [--shadow-color:var(--primary-stroke)] hover:bg-primary-hover active:translate-y-[var(--shadow-offset)] active:shadow-none">
            Get started <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <Link href="/login" className="inline-flex h-11 items-center rounded-md border border-button-stroke bg-button px-6 text-sm font-medium text-foreground shadow-solid hover:bg-button-hover active:translate-y-[var(--shadow-offset)] active:shadow-none">
            Log in
          </Link>
          <span className="text-xs text-muted-foreground">Free demo workspace, no card required.</span>
        </div>
      </section>

      <section className="mb-12">
        <ExampleReport />
      </section>

      <section className="mb-12 grid gap-4 sm:grid-cols-3" aria-label="What makes it different">
        <Pillar icon={<ListOrdered className="size-5 text-primary" aria-hidden="true" />} title="Prioritized, explained" text="Of forty alerts, which three matter in this project, why, and what to do in one sentence. Deterministic, auditable rules; no model decides." />
        <Pillar icon={<ScanSearch className="size-5 text-primary" aria-hidden="true" />} title="Built for AI-generated code" text="Hardcoded keys in client bundles, Supabase without RLS, open CORS with credentials, committed .env files: the mistakes Lovable, Bolt, Cursor and v0 projects actually ship." />
        <Pillar icon={<Siren className="size-5 text-primary" aria-hidden="true" />} title="A gate, not a report" text="The same engine runs in your CI on every pull request and blocks what should not merge, with the fix spelled out in the PR." />
      </section>

      <section className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <span>Open source, MIT.</span>
        <Link href="/how-it-works" className="text-primary hover:underline">How it works</Link>
        <Link href="/get-started" className="text-primary hover:underline">Run it in your CI</Link>
        <Link href="/resources" className="text-primary hover:underline">Rules and limits</Link>
      </section>
    </>
  );
}

function Pillar({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
    </Card>
  );
}

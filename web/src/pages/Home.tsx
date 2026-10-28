import { Card, CardContent, buttonVariants, cn } from "@gateseeker/ui-kit";
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
      <section className="relative mb-14 pt-4 sm:mb-20 sm:pt-10">
        <div className="relative mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.5rem]">Your app was built fast. Find out what shipped with it.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Gateseeker reads your repository (never runs it), checks the installed dependencies against OSV and a curated advisory feed, looks for the insecure patterns common in vibe-coded apps, and ranks every finding with explainable rules.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/get-started" className={cn(buttonVariants({ size: "lg" }), "h-11 w-full px-6 text-base sm:w-auto")}>
              Get started <ArrowRight aria-hidden="true" />
            </Link>
            <Link href="/login" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-11 w-full px-6 text-base sm:w-auto")}>
              Log in
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Free demo workspace, no card required. Open source, MIT.</p>
        </div>
      </section>

      <section className="mb-16 sm:mb-20">
        <ExampleReport />
      </section>

      <section className="mb-16 sm:mb-20" aria-labelledby="pillars">
        <div className="mb-6 max-w-2xl">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-primary">What makes it different</p>
          <h2 id="pillars" className="text-2xl font-semibold tracking-tight sm:text-3xl">Three things a dependency alert never tells you</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Pillar icon={<ListOrdered aria-hidden="true" />} title="Prioritized, explained" text="Of forty alerts, which three matter in this project, why, and what to do in one sentence. Deterministic, auditable rules; no model decides." />
          <Pillar icon={<ScanSearch aria-hidden="true" />} title="Built for AI-generated code" text="Hardcoded keys in client bundles, Supabase without RLS, open CORS with credentials, committed .env files: the mistakes Lovable, Bolt, Cursor and v0 projects actually ship." />
          <Pillar icon={<Siren aria-hidden="true" />} title="A gate, not a report" text="The same engine runs in your CI on every pull request and blocks what should not merge, with the fix spelled out in the PR." />
        </div>
      </section>

      <section className="relative overflow-hidden rounded-xl border bg-card">
        <div className="relative flex flex-col items-start gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Make it a gate on every pull request</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">One workflow file, no account, no token. The check fails when a P1 or P2 finding appears, with the fix spelled out in the PR.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/get-started" className={buttonVariants({ size: "default" })}>
              Run it in your CI <ArrowRight aria-hidden="true" />
            </Link>
            <Link href="/how-it-works" className={buttonVariants({ size: "default", variant: "outline" })}>
              How it works
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Pillar({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <Card className="transition-colors hover:border-border-strong">
      <CardContent className="p-5">
        <span className="mb-4 flex size-10 items-center justify-center rounded-lg border border-primary/35 bg-primary/12 text-primary [&_svg]:size-5">{icon}</span>
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

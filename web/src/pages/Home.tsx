import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { ListOrdered, ScanSearch, Siren } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { ScanResponseOk } from "../api";
import { CiSnippet } from "../components/CiSnippet";
import { Scanner } from "../components/Scanner";
import { Link } from "../router";

export function Home() {
  const [result, setResult] = useState<ScanResponseOk | null>(null);
  return (
    <>
      <section className="mb-10">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">Security gate for AI-generated code</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your app was built fast. Find out what shipped with it.</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Paste the URL of a public GitHub repository. Gateseeker reads it (never runs it), checks the installed dependencies against OSV and a curated advisory feed, looks for the insecure patterns common in vibe-coded apps, and ranks every finding with explainable rules.
        </p>
        <div className="mt-6">
          <Scanner onResult={setResult} />
        </div>
      </section>

      {result && (
        <div className="mb-10">
          <CiSnippet repository={result.repository} />
        </div>
      )}

      <section className="mb-10 grid gap-4 sm:grid-cols-3" aria-label="What makes it different">
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
      <CardContent className="hidden" />
    </Card>
  );
}

import { useState } from "react";

import type { ScanResponseOk } from "../api";
import { CiSnippet } from "../components/CiSnippet";
import { Scanner } from "../components/Scanner";

/**
 * The demo workspace (/app): paste the URL of a public GitHub repository and
 * read the report. Provisional and unguarded: the sign-in requirement is added
 * when accounts exist. The browser tests drive the scanner from this route.
 */
export function AppDemo() {
  const [result, setResult] = useState<ScanResponseOk | null>(null);
  return (
    <>
      <section className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Analyze a repository</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Paste the URL of a public GitHub repository. Gateseeker reads it, never runs it, and returns the prioritized report on this page.</p>
      </section>
      <Scanner onResult={setResult} />
      {result && (
        <div className="mb-10">
          <CiSnippet repository={result.repository} />
        </div>
      )}
    </>
  );
}

import { useState } from "react";

import type { ScanResponseOk } from "../api";
import { CiSnippet } from "../components/CiSnippet";
import { PageIntro } from "../components/PageIntro";
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
      <PageIntro eyebrow="Demo workspace" title="Analyze a repository" lead="Paste the URL of a public GitHub repository. Gateseeker reads it, never runs it, and returns the prioritized report on this page." />
      <Scanner onResult={setResult} />
      {result && (
        <div className="mb-10">
          <CiSnippet repository={result.repository} />
        </div>
      )}
    </>
  );
}

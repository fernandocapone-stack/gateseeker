import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { ScanResponseOk } from "../api";
import { useAuth } from "../auth-context";
import { CiSnippet } from "../components/CiSnippet";
import { PageIntro } from "../components/PageIntro";
import { Scanner } from "../components/Scanner";
import { navigate } from "../router";

/**
 * The demo workspace (/app): paste the URL of a public GitHub repository and
 * read the report. Requires a session: signed-out visitors go to /login and
 * come back here afterwards.
 */
export function AppDemo() {
  const auth = useAuth();
  const [result, setResult] = useState<ScanResponseOk | null>(null);

  useEffect(() => {
    if (auth.status === "signed-out") navigate("/login?next=/app");
  }, [auth.status]);

  if (auth.status !== "signed-in" || !auth.session) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Checking your session
      </p>
    );
  }
  return (
    <>
      <PageIntro eyebrow="Demo workspace" title="Analyze a repository" lead="Paste the URL of a public GitHub repository. Gateseeker reads it, never runs it, and returns the prioritized report on this page." />
      <Scanner token={auth.session.accessToken} onResult={setResult} />
      {result && (
        <div className="mb-10">
          <CiSnippet repository={result.repository} />
        </div>
      )}
    </>
  );
}

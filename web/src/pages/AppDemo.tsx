import { useEffect, useState } from "react";

import type { ScanResponseOk } from "../api";
import { useAuth } from "../auth-context";
import { CiSnippet } from "../components/CiSnippet";
import { Scanner } from "../components/Scanner";
import { PageSkeleton } from "../components/Skeletons";
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
    return <PageSkeleton label="Checking your session" />;
  }
  return (
    <>
      <Scanner
        token={auth.session.accessToken}
        onResult={setResult}
        heading={
          <div>
            <h1 className="text-display font-medium">Find what to fix before you ship</h1>
            <p className="text-label text-muted-foreground">Paste the URL of a public GitHub repository. Gateseeker reads it, never runs it, and returns the prioritized report on this page.</p>
          </div>
        }
      />
      {result && (
        <div className="mt-6 print:hidden">
          <CiSnippet repository={result.repository} />
        </div>
      )}
    </>
  );
}

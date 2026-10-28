import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchReport, type ReportOutcome } from "../api";
import { useAuth } from "../auth-context";
import { CiSnippet } from "../components/CiSnippet";
import { setLastReportId } from "../last-report";
import { Link } from "../router";
import { ReportView } from "../views/Report";

/**
 * /r/<id>: a report saved for the signed-in account. The id alone opens
 * nothing: the service returns a report only to the account that produced it.
 */
export function SavedReport({ id }: { id: string }) {
  const auth = useAuth();
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);

  useEffect(() => {
    if (auth.status !== "signed-in" || !auth.session) return;
    let cancelled = false;
    setOutcome(null);
    void fetchReport(id, auth.session.accessToken).then((o) => {
      if (cancelled) return;
      setOutcome(o);
      if (o.ok) setLastReportId(o.id);
    });
    return () => { cancelled = true; };
  }, [auth.status, auth.session, id]);

  if (auth.status === "loading" || (auth.status === "signed-in" && outcome === null)) {
    return (
      <p role="status" className="flex items-center gap-2 text-body text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading the saved report
      </p>
    );
  }
  if (auth.status === "signed-out") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in to open this report</CardTitle>
          <CardDescription>Saved reports belong to the account that produced them.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={`/login?next=/r/${id}`} className="text-primary hover:underline">Log in</Link>
        </CardContent>
      </Card>
    );
  }
  if (!outcome || !outcome.ok) {
    return (
      <Card role="alert">
        <CardHeader>
          <CardTitle>Report not available</CardTitle>
          <CardDescription>{outcome && !outcome.ok ? outcome.error.message : "No report with this id."}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/app" className="text-primary hover:underline">Analyze a repository</Link>
        </CardContent>
      </Card>
    );
  }
  const response = { ...outcome.saved, id: outcome.id, cached: false, quota: null };
  return (
    <>
      <p className="mb-4 text-label text-muted-foreground print:hidden">
        Saved report <code>{outcome.id}</code>, kept until {new Date(outcome.expiresAt).toLocaleDateString()}. <Link href="/app" className="text-primary hover:underline">Analyze another repository</Link>.
      </p>
      <ReportView response={response} elapsedMs={outcome.saved.timings.totalMs} />
      <div className="mt-6 print:hidden">
        <CiSnippet repository={outcome.saved.repository} />
      </div>
    </>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { useEffect, useState } from "react";

import { clearScanNote, readScanNote } from "../scan-note";

import { fetchReport, type ReportOutcome } from "../api";
import { useAuth } from "../auth-context";
import { CiSnippet } from "../components/CiSnippet";
import { ReportSkeleton } from "../components/Skeletons";
import { Link } from "../router";
import { ReportView } from "../views/Report";
import { useWorkspaceTitle } from "../Workspace";

/**
 * /r/<id>: a report saved for the signed-in account. The id alone opens
 * nothing: the service returns a report only to the account that produced it.
 * In the workspace it is a scan: the header shows "owner/repo" with a back
 * button to the Scans list.
 */
export function SavedReport({ id }: { id: string }) {
  const auth = useAuth();
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);
  // Left by the analyze view when it opened this report right after an analysis.
  const [note] = useState(() => readScanNote(id));
  useEffect(() => { clearScanNote(id); }, [id]);

  useEffect(() => {
    if (auth.status !== "signed-in" || !auth.session) return;
    let cancelled = false;
    setOutcome(null);
    void fetchReport(id, auth.session.accessToken).then((o) => {
      if (cancelled) return;
      setOutcome(o);
    });
    return () => { cancelled = true; };
  }, [auth.status, auth.session, id]);

  const name = outcome?.ok ? `${outcome.saved.repository.owner}/${outcome.saved.repository.repo}` : null;
  useWorkspaceTitle(name);
  useEffect(() => {
    if (name) document.title = `${name} · Gateseeker`;
  }, [name]);

  if (auth.status === "loading" || (auth.status === "signed-in" && outcome === null)) {
    return <ReportSkeleton label="Loading the saved report" />;
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
      <div className="mb-4 print:hidden">
        <h1 className="sr-only">{name}</h1>
        <p className="text-label text-muted-foreground">
          Commit <span className="font-mono">{outcome.saved.repository.sha.slice(0, 7)}</span> · in your Scans until {new Date(outcome.expiresAt).toLocaleDateString()}.
        </p>
        {note && (
          <p className="mt-1 text-label text-muted-foreground" data-testid="saved-note">
            {note.cached ? "Reused a report of this commit from the last 24 hours, so it did not count toward your limit." : note.used !== null && note.limit !== null ? `${String(note.used)} of ${String(note.limit)} analyses used this hour.` : ""}
          </p>
        )}
      </div>
      <ReportView response={response} elapsedMs={outcome.saved.timings.totalMs} />
      <div className="mt-6 print:hidden">
        <CiSnippet repository={outcome.saved.repository} />
      </div>
    </>
  );
}

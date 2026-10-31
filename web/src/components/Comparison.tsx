import { Card } from "@gateseeker/ui-kit";
import { compareReports, type Comparison } from "gateseeker/dist/report/compare.js";
import { ArrowRightLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchReport, type ReportResponseOk } from "../api";
import { useScanHistory } from "../history";

/**
 * "What changed since the last scan" (docs/SPRINT_6.md 3.2). The previous
 * analysis is the newest earlier one of the same repository on a different
 * commit whose report is still kept (30 days); the comparison itself is the
 * engine's (src/report/compare.ts). Nothing is shown when there is no such
 * analysis or it cannot be loaded.
 */

export interface PreviousComparison {
  comparison: Comparison;
  previous: { at: string; sha: string };
}

const REPORT_DAYS = 30;

export function useComparison(current: ReportResponseOk | null, userId: string | null, token: string | null): PreviousComparison | null {
  const { records } = useScanHistory(userId, token);
  const [result, setResult] = useState<PreviousComparison | null>(null);
  const repo = current ? `${current.saved.repository.owner}/${current.saved.repository.repo}`.toLowerCase() : "";
  const sha = current?.saved.repository.sha.slice(0, 7) ?? "";
  const createdAt = current ? Date.parse(current.createdAt) : 0;
  const previous = records.find(
    (r) =>
      `${r.owner}/${r.repo}`.toLowerCase() === repo &&
      r.sha !== sha &&
      r.reportId !== null &&
      r.reportId !== current?.id &&
      Date.parse(r.at) < createdAt &&
      createdAt - Date.parse(r.at) < REPORT_DAYS * 86_400_000,
  );
  const previousId = previous?.reportId ?? null;

  useEffect(() => {
    setResult(null);
    if (!current || !token || previousId === null || !previous) return;
    let cancelled = false;
    void fetchReport(previousId, token).then((o) => {
      if (cancelled || !o.ok) return;
      setResult({ comparison: compareReports(o.saved.report, current.saved.report), previous: { at: previous.at, sha: previous.sha } });
    });
    return () => { cancelled = true; };
    // `previous` is derived from the history on every render; previousId identifies it.
  }, [current?.id, token, previousId]);

  return result;
}

export function ComparisonBand({ data }: { data: PreviousComparison }) {
  const { comparison: c, previous } = data;
  const when = new Date(previous.at).toLocaleDateString();
  return (
    <Card className="grid gap-2 p-4 print:break-inside-avoid" data-testid="comparison">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
        <ArrowRightLeft className="size-4 text-primary" aria-hidden="true" />
        <span className="font-medium">Since the scan of {when}</span>
        <span className="font-mono text-label text-muted-foreground">{previous.sha}</span>
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-body">
        <span className={c.newFindings.length > 0 ? "text-destructive" : undefined}>{c.newFindings.length} new</span>
        <span className={c.fixed.length > 0 ? "text-success" : undefined}>{c.fixed.length} fixed</span>
        <span>{c.stillOpen.length} still open</span>
        {c.unverified.length > 0 && <span className="text-warning">{c.unverified.length} not checked this time</span>}
      </p>
      {c.fixed.length > 0 && (
        <details className="text-label text-muted-foreground">
          <summary className="cursor-pointer select-none">What was fixed</summary>
          <ul className="mt-2 grid gap-1">
            {c.fixed.map((f) => (
              <li key={f.id}>
                <span className="text-foreground">{f.evidence.kind === "insecure-pattern" ? `${f.evidence.ruleId}: ${f.evidence.title}` : f.evidence.kind === "dependency-vulnerability" ? f.evidence.vulnerabilityId : (f.evidence.advisoryId ?? f.evidence.ruleId ?? f.evidence.type)}</span>{" "}
                <span className="font-mono">{f.subject}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

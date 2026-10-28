import { Badge, Table, Td, Th, buttonVariants, cn } from "@gateseeker/ui-kit";

import type { AnalysisRecord } from "../history";
import { formatWhen } from "../notifications";
import { Link } from "../router";

/**
 * Table of analyses from the local history: repository with commit and time,
 * verdict, findings per priority and a link to the saved scan. Used by the
 * Dashboard (latest per repository) and the Scans list (every analysis).
 */

const REPORT_DAYS = 30;

function reportOpen(r: AnalysisRecord, now: number): boolean {
  return r.reportId !== null && now - Date.parse(r.at) < REPORT_DAYS * 24 * 60 * 60 * 1000;
}

function VerdictBadge({ verdict }: { verdict: AnalysisRecord["verdict"] }) {
  if (verdict === "fail") return <Badge variant="critical">fail</Badge>;
  if (verdict === "incomplete") return <Badge variant="high">incomplete</Badge>;
  return <Badge variant="kind">pass</Badge>;
}

export function ScanTable({ rows, label }: { rows: AnalysisRecord[]; label: string }) {
  const now = Date.now();
  return (
    <Table aria-label={label}>
      <thead>
        <tr>
          <Th>Repository</Th>
          <Th className="w-28">Verdict</Th>
          <Th className="w-56">Findings</Th>
          <Th className="w-[130px]">Action</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.owner}/${r.repo}@${r.at}`} className="border-b last:border-b-0">
            <Td>
              <div className="grid gap-0.5">
                <span className="text-body font-medium break-all">{r.owner}/{r.repo}</span>
                <span className="text-label font-light text-muted-foreground">
                  Commit <span className="font-mono">{r.sha}</span> · <time dateTime={r.at}>{formatWhen(r.at, now)}</time>
                </span>
              </div>
            </Td>
            <Td><VerdictBadge verdict={r.verdict} /></Td>
            <Td>
              <span className="flex flex-wrap gap-x-3 text-body tabular-nums">
                {(["P1", "P2", "P3", "P4"] as const).map((p) => (
                  <span key={p} className={cn(r.byPriority[p] === 0 && "text-muted-foreground")}>
                    <span className="text-label text-muted-foreground">{p}</span> {r.byPriority[p]}
                  </span>
                ))}
              </span>
            </Td>
            <Td>
              {reportOpen(r, now) ? (
                <Link href={`/r/${r.reportId ?? ""}`} className={buttonVariants({ variant: "outline", size: "md" })}>View scan</Link>
              ) : (
                <span className="text-label text-muted-foreground">Report expired</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

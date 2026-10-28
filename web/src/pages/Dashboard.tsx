import { Badge, Card, MetricCard, Table, Td, Th, buttonVariants, cn } from "@gateseeker/ui-kit";
import { ArrowRight } from "lucide-react";
import { useEffect } from "react";

import { useAuth } from "../auth-context";
import { PageSkeleton } from "../components/Skeletons";
import { latestPerRepository, useHistory, type AnalysisRecord } from "../history";
import { formatWhen } from "../notifications";
import { Link, navigate } from "../router";

/**
 * /app/dashboard: the repositories this account analyzed in this browser,
 * each with its latest verdict and findings per priority. Built only from
 * the local history (history.ts); a saved report opens for 30 days.
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

export function Dashboard() {
  const auth = useAuth();
  const history = useHistory(auth.session?.user.id ?? null);

  useEffect(() => {
    if (auth.status === "signed-out") navigate("/login?next=/app/dashboard");
  }, [auth.status]);

  if (auth.status !== "signed-in" || !auth.session) return <PageSkeleton label="Checking your session" />;

  const latest = latestPerRepository(history);
  const now = Date.now();
  const p1 = latest.reduce((n, r) => n + r.byPriority.P1, 0);
  const p2 = latest.reduce((n, r) => n + r.byPriority.P2, 0);
  const blocked = latest.filter((r) => r.verdict !== "pass").length;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-display font-medium">How your repositories are doing</h1>
        <p className="text-label text-muted-foreground">The latest analysis of each repository you checked in this browser.</p>
      </div>

      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: "Repositories", value: latest.length, note: `${String(history.length)} ${history.length === 1 ? "analysis" : "analyses"} in total` },
          { label: "P1 · Fix now", value: p1, note: "in the latest analyses" },
          { label: "P2 · Fix before release", value: p2, note: "in the latest analyses" },
          { label: "Gate not passing", value: blocked, note: "fail or incomplete" },
        ].map((m) => (
          <div key={m.label}>
            <dt className="sr-only">{m.label}</dt>
            <dd>
              <MetricCard label={m.label} value={m.value} note={m.note} className="h-full" />
            </dd>
          </div>
        ))}
      </dl>

      {latest.length === 0 ? (
        <Card className="grid justify-items-start gap-3 p-4">
          <div className="grid gap-1">
            <h2 className="text-title font-medium">No analyses yet</h2>
            <p className="text-label text-muted-foreground">Analyze a public GitHub repository and it shows up here with its verdict and findings per priority.</p>
          </div>
          <Link href="/app" className={buttonVariants({ size: "sm" })}>
            Analyze a repository <ArrowRight aria-hidden="true" />
          </Link>
        </Card>
      ) : (
        <>
          <h2 className="sr-only">Repositories</h2>
          <Table aria-label="Repositories">
            <thead>
              <tr>
                <Th>Repository</Th>
                <Th className="w-28">Verdict</Th>
                <Th className="w-56">Findings</Th>
                <Th className="w-[130px]">Action</Th>
              </tr>
            </thead>
            <tbody>
              {latest.map((r) => (
                <tr key={`${r.owner}/${r.repo}`} className="border-b last:border-b-0">
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
                      <Link href={`/r/${r.reportId ?? ""}`} className={buttonVariants({ variant: "outline", size: "md" })}>View issues</Link>
                    ) : (
                      <span className="text-label text-muted-foreground">Report expired</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-caption text-muted-foreground">Kept in this browser for this account, last 100 analyses. Saved reports open for 30 days.</p>
        </>
      )}
    </div>
  );
}

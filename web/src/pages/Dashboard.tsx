import { Card, MetricCard, buttonVariants } from "@gateseeker/ui-kit";
import { ArrowRight } from "lucide-react";
import { useEffect } from "react";

import { useAuth } from "../auth-context";
import { ScanTable } from "../components/ScanTable";
import { PageSkeleton } from "../components/Skeletons";
import { latestPerRepository, useScanHistory } from "../history";
import { Link, navigate } from "../router";

/**
 * /app/dashboard: the repositories this account analyzed in this browser,
 * each with its latest verdict and findings per priority. Built only from
 * the local history (history.ts); a saved report opens for 30 days.
 */

export function Dashboard() {
  const auth = useAuth();
  const { records: history, source } = useScanHistory(auth.session?.user.id ?? null, auth.session?.accessToken ?? null);

  useEffect(() => {
    if (auth.status === "signed-out") navigate("/login?next=/app/dashboard");
  }, [auth.status]);

  if (auth.status !== "signed-in" || !auth.session) return <PageSkeleton label="Checking your session" />;

  const latest = latestPerRepository(history);
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
          <ScanTable rows={latest} label="Repositories" />
          <p className="text-caption text-muted-foreground">{source === "server" ? "Kept on your account for 180 days, on any device. Saved reports open for 30 days." : "Showing this browser's copy (your account history could not be loaded). Saved reports open for 30 days."}</p>
        </>
      )}
    </div>
  );
}

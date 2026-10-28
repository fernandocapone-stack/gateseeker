import { Card, buttonVariants } from "@gateseeker/ui-kit";
import { ArrowRight } from "lucide-react";
import { useEffect } from "react";

import { useAuth } from "../auth-context";
import { ScanTable } from "../components/ScanTable";
import { PageSkeleton } from "../components/Skeletons";
import { useHistory } from "../history";
import { Link, navigate } from "../router";

/**
 * /app/scans: every analysis this account ran in this browser, newest first,
 * each opening its saved scan (/r/<id>) while the report is kept. Built only
 * from the local history (history.ts), like the Dashboard.
 */
export function Scans() {
  const auth = useAuth();
  const history = useHistory(auth.session?.user.id ?? null);

  useEffect(() => {
    if (auth.status === "signed-out") navigate("/login?next=/app/scans");
  }, [auth.status]);

  if (auth.status !== "signed-in" || !auth.session) return <PageSkeleton label="Checking your session" />;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-display font-medium">Your scans</h1>
        <p className="text-label text-muted-foreground">Every analysis you ran in this browser, newest first. Open one to see its findings.</p>
      </div>

      {history.length === 0 ? (
        <Card className="grid justify-items-start gap-3 p-4">
          <div className="grid gap-1">
            <h2 className="text-title font-medium">No scans yet</h2>
            <p className="text-label text-muted-foreground">Analyze a public GitHub repository and the scan shows up here.</p>
          </div>
          <Link href="/app" className={buttonVariants({ size: "sm" })}>
            Analyze a repository <ArrowRight aria-hidden="true" />
          </Link>
        </Card>
      ) : (
        <>
          <ScanTable rows={history} label="Scans" />
          <p className="text-caption text-muted-foreground">Kept in this browser for this account, last 100 analyses. Saved reports open for 30 days.</p>
        </>
      )}
    </div>
  );
}

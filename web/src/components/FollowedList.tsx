import { Button } from "@gateseeker/ui-kit";

import { useFollows } from "../follows";
import { Link } from "../router";

/** The followed repositories in Settings: what the daily check found last, and Unfollow. */
export function FollowedList({ token }: { token: string }) {
  const { follows, error, unfollow } = useFollows(token);
  if (follows === null) return error ? <p role="alert" className="text-label text-warning">{error}</p> : <p className="text-label text-muted-foreground">Loading…</p>;
  if (follows.length === 0) return <p className="text-label text-muted-foreground">You are not following any repository. Open a scan and press Follow to have it checked every day.</p>;
  return (
    <ul className="grid gap-3" aria-label="Followed repositories">
      {follows.map((f) => {
        const status = f.pausedReason
          ? `Paused: ${f.pausedReason}`
          : f.lastScanAt === null
            ? "Not checked yet; the next daily check picks it up."
            : f.failures > 0
              ? `The last ${f.failures === 1 ? "check" : `${String(f.failures)} checks`} could not finish. It will try again tomorrow.`
              : `Checked ${new Date(f.lastScanAt).toLocaleDateString()}: ${f.lastNewUrgent > 0 ? `${String(f.lastNewUrgent)} new finding(s) to fix soon` : "nothing new to fix soon"}.`;
        return (
          <li key={`${f.owner}/${f.repo}`} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
            <div className="grid min-w-0 gap-0.5">
              <span className="text-body font-medium break-all">{f.owner}/{f.repo}</span>
              <span className={f.pausedReason || f.failures > 0 ? "text-label text-warning" : "text-label text-muted-foreground"}>{status}</span>
              {f.lastReportId && <Link href={`/r/${f.lastReportId}`} className="text-label text-primary hover:underline">Open the last report</Link>}
            </div>
            <Button variant="outline" size="sm" onClick={() => void unfollow(f.owner, f.repo)}>Unfollow</Button>
          </li>
        );
      })}
    </ul>
  );
}

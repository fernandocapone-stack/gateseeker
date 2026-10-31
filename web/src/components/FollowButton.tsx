import { Button } from "@gateseeker/ui-kit";
import { Bell, BellRing } from "lucide-react";
import { useState } from "react";

import { useFollows } from "../follows";

/**
 * Follow a repository: the daily monitor rescans it and, once alerts are on,
 * emails the account when a new P1 or P2 finding appears. A follow is the
 * explicit, reversible consent docs/SPRINT_6.md 2.4 asks for.
 */
export function FollowButton({ owner, repo, token }: { owner: string; repo: string; token: string }) {
  const { follows, error, isFollowing, follow, unfollow } = useFollows(token);
  const [busy, setBusy] = useState(false);
  if (follows === null && error === null) return null;
  const on = isFollowing(owner, repo);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant={on ? "outline" : "default"}
        size="sm"
        aria-pressed={on}
        disabled={busy}
        title={on ? "Stop the daily check of this repository" : "Check this repository every day"}
        onClick={() => {
          setBusy(true);
          void (on ? unfollow(owner, repo) : follow(owner, repo)).finally(() => { setBusy(false); });
        }}
      >
        {on ? <BellRing className="text-primary" aria-hidden="true" /> : <Bell aria-hidden="true" />} {on ? "Following" : "Follow"}
      </Button>
      {error && <span role="alert" className="text-label text-warning">{error}</span>}
    </div>
  );
}

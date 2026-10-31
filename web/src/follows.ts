import { useCallback, useEffect, useState } from "react";

import { callFollows, type FollowView } from "./api";

/**
 * The account's followed repositories (docs/SPRINT_6.md 3.3), shared by the
 * Follow button and the Settings list: every change broadcasts the new list
 * to the other components on the page.
 */

const EVENT = "gateseeker:follows";

export function useFollows(token: string | null) {
  const [follows, setFollows] = useState<FollowView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void callFollows("GET", token).then((r) => {
      if (cancelled) return;
      if (r.ok) setFollows(r.follows);
      else setError(r.error.message);
    });
    const onChange = (e: Event) => { setFollows((e as CustomEvent<FollowView[]>).detail); };
    window.addEventListener(EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT, onChange);
    };
  }, [token]);

  const change = useCallback(
    async (method: "POST" | "DELETE", owner: string, repo: string): Promise<boolean> => {
      if (!token) return false;
      setError(null);
      const r = await callFollows(method, token, { owner, repo });
      if (!r.ok) {
        setError(r.error.message);
        return false;
      }
      setFollows(r.follows);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: r.follows }));
      return true;
    },
    [token],
  );

  const isFollowing = (owner: string, repo: string): boolean => (follows ?? []).some((f) => f.owner === owner.toLowerCase() && f.repo === repo.toLowerCase());

  return { follows, error, isFollowing, follow: (o: string, r: string) => change("POST", o, r), unfollow: (o: string, r: string) => change("DELETE", o, r) };
}

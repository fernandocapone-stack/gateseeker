import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { useState } from "react";

import { Link } from "../router";

/**
 * /unsubscribe?f=<follow>&t=<token>: the link at the bottom of every email
 * (docs/SPRINT_6.md 3.6). It works without signing in. Opening the page
 * changes nothing (mail scanners open links on their own); the button does.
 */

type State = { step: "ready" } | { step: "busy" } | { step: "done"; repository: string | null } | { step: "error"; message: string };

export function Unsubscribe() {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const f = params.get("f") ?? "";
  const t = params.get("t") ?? "";
  const [state, setState] = useState<State>({ step: "ready" });

  async function confirm(): Promise<void> {
    setState({ step: "busy" });
    try {
      const res = await fetch("/api/unsubscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ f, t }) });
      const body = (await res.json()) as { ok: boolean; repository?: string | null; error?: { message: string } };
      if (body.ok) setState({ step: "done", repository: body.repository ?? null });
      else setState({ step: "error", message: body.error?.message ?? "This unsubscribe link is not valid." });
    } catch {
      setState({ step: "error", message: "The service could not be reached. Try again in a minute." });
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{state.step === "done" ? "You stopped following" : "Stop following this repository"}</h1>
          </CardTitle>
          <CardDescription>
            {state.step === "done"
              ? state.repository
                ? `Gateseeker no longer checks ${state.repository} for you and will not email you about it.`
                : "This repository was already unfollowed. No more emails will come about it."
              : "Gateseeker will stop the daily check of this repository and the emails about it. Other repositories you follow are not affected."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {state.step === "error" && <p role="alert" className="text-label text-warning">{state.message}</p>}
          {state.step !== "done" && (
            <Button onClick={() => void confirm()} disabled={state.step === "busy" || !f || !t}>
              Stop following
            </Button>
          )}
          <Link href="/app/settings" className="text-label text-primary hover:underline">
            Manage followed repositories in Settings
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

import { Button, Card, CardContent, CardDescription, CardHeader } from "@gateseeker/ui-kit";
import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { safeNext, takeNext } from "../auth";
import { useAuth } from "../auth-context";
import { navigate } from "../router";

/**
 * Sign-in page. "Continue with GitHub" starts Supabase Auth's OAuth flow
 * (or the stub in local/test mode). After the round trip the page lands here
 * again with a session and forwards to the remembered in-app path.
 */
export function Login() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const next = safeNext(new URLSearchParams(window.location.search).get("next") ?? "/app");

  useEffect(() => {
    if (auth.status === "signed-in") navigate(takeNext() === "/app" ? next : takeNext());
  }, [auth.status, next]);

  async function start() {
    setBusy(true);
    await auth.signIn(next);
    // On OAuth the browser navigates away; in stub mode the session appears at once and the effect above forwards.
    setBusy(false);
  }

  const unavailable = auth.status !== "loading" && auth.mode === "none";
  return (
    <section className="relative mx-auto max-w-sm py-8 sm:py-12">
      <Card className="relative">
        <CardHeader className="items-center text-center">
          <span className="mb-2 flex size-11 items-center justify-center rounded-lg border border-primary/40 bg-primary/15 text-primary">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold leading-snug tracking-tight">Log in</h1>
          <CardDescription>Sign in to open the demo workspace and analyze a public GitHub repository.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button size="lg" className="h-11 w-full" disabled={busy || auth.status === "loading" || unavailable} onClick={() => void start()}>
            {busy || auth.status === "loading" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <GitHubMark />} Continue with GitHub
          </Button>
          {unavailable ? (
            <p role="alert" className="text-center text-xs text-warning">Sign-in is not configured on this server. Run the CLI locally instead.</p>
          ) : (
            <p className="text-center text-xs text-muted-foreground">The demo workspace is free and rate limited. Public repositories only; nothing is installed or executed. We read your GitHub login and avatar, nothing else.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/* lucide-react no longer ships brand icons, so the GitHub mark is inlined. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

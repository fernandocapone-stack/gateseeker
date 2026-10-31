import { Button, IconInput, Logo, cn } from "@gateseeker/ui-kit";
import { ArrowLeft, ArrowRight, History, Sparkles } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { useAuth } from "../auth-context";
import { Progress, Refusal, ScanIcon, useScan } from "../components/Scanner";
import { PageSkeleton } from "../components/Skeletons";
import { latestPerRepository, useScanHistory } from "../history";
import { navigate } from "../router";
import { leaveScanNote, workspaceBackPath } from "../scan-note";
import { ReportView } from "../views/Report";

/**
 * /app: the analyze view, full screen and focused on one thing (the PO's
 * design, 2026-10-31). Opened from the header's Analyze button or with "/"
 * anywhere in the workspace. The header has only a back button; Esc does
 * the same. The URL field sits in the middle with two kinds of shortcuts
 * under it: an example repository and the last repositories analyzed.
 *
 * A finished analysis with a saved report goes to its page (/r/<id>), so the
 * report lives in one place; the quota and cache note travels with it.
 * Refusals stay here, under the field, so the URL can be fixed in place.
 */

function useExampleRepo(): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/config")
      .then((r) => r.json() as Promise<{ exampleRepo?: unknown }>)
      .then((b) => { if (!cancelled && typeof b.exampleRepo === "string") setUrl(b.exampleRepo); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return url;
}

export function AnalyzePage() {
  const auth = useAuth();
  useEffect(() => {
    if (auth.status === "signed-out") navigate("/login?next=/app");
  }, [auth.status]);
  if (auth.status !== "signed-in" || !auth.session) {
    return (
      <FocusFrame onBack={() => { navigate("/"); }}>
        <PageSkeleton label="Checking your session" />
      </FocusFrame>
    );
  }
  return <Analyze token={auth.session.accessToken} userId={auth.session.user.id} />;
}

function FocusFrame({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-[51px] items-center gap-2 border-b bg-sidebar px-4">
        <Button variant="outline" size="icon" aria-label="Back" title="Back (Esc)" onClick={onBack}>
          <ArrowLeft className="text-primary" aria-hidden="true" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-title font-medium">Analyze a repository</p>
        <span className="hidden text-label text-muted-foreground sm:inline">Esc to close</span>
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pb-12">{children}</main>
    </div>
  );
}

function Analyze({ token, userId }: { token: string; userId: string }) {
  const [url, setUrl] = useState("");
  const { phase, start, cancel } = useScan(token);
  const example = useExampleRepo();
  const recent = latestPerRepository(useScanHistory(userId, token).records).slice(0, 3);
  const running = phase.kind === "running";

  const leave = () => {
    if (running && !window.confirm("Stop the analysis and leave?")) return;
    if (running) cancel();
    navigate(workspaceBackPath());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  });

  async function run(target: string) {
    setUrl(target);
    const outcome = await start(target);
    if (outcome?.ok && outcome.id !== null) {
      leaveScanNote(outcome.id, { cached: outcome.cached, used: outcome.quota?.used ?? null, limit: outcome.quota?.limit ?? null });
      navigate(`/r/${outcome.id}`);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(url);
  }

  return (
    <FocusFrame onBack={leave}>
      <div className={cn("grid w-full max-w-xl justify-items-center gap-4 text-center", phase.kind === "idle" ? "mt-[14vh]" : "mt-10")}>
        <Logo className="h-7 w-auto" />
        <h1 className="text-display font-medium">Find what to fix before you ship</h1>
        <p className="text-label text-muted-foreground">Paste the URL of a public GitHub repository. Gateseeker reads it, never runs it, and ranks what to fix.</p>
        <form onSubmit={submit} className="flex w-full flex-col gap-2 sm:flex-row">
          <IconInput
            autoFocus
            icon={<ScanIcon />}
            aria-label="Repository URL"
            placeholder="https://github.com/owner/repository"
            value={url}
            onChange={(e) => { setUrl(e.target.value); }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="url"
            className="sm:flex-1"
            disabled={running}
          />
          {running ? (
            <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
          ) : (
            <Button type="submit">
              Analyze <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </form>
        <p className="text-caption text-muted-foreground">Public repositories only, up to 50 MB compressed. Nothing is installed or run. Reports stay in your Scans for 30 days.</p>
        {!running && (example !== null || recent.length > 0) && (
          <div className="flex flex-wrap justify-center gap-2" aria-label="Shortcuts">
            {example !== null && (
              <button type="button" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-label text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void run(example)}>
                <Sparkles className="size-3.5 text-primary" aria-hidden="true" /> Try an example
              </button>
            )}
            {recent.map((r) => (
              <button key={`${r.owner}/${r.repo}`} type="button" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-label text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => void run(`https://github.com/${r.owner}/${r.repo}`)}>
                <History className="size-3.5" aria-hidden="true" /> {r.owner}/{r.repo}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={cn("mt-8 w-full", phase.kind === "done" && phase.outcome.ok ? "max-w-5xl" : "max-w-xl")}>
        {running && <Progress startedAt={phase.startedAt} url={phase.url} />}
        {phase.kind === "done" && !phase.outcome.ok && <Refusal url={phase.url} code={phase.outcome.error.code} message={phase.outcome.error.message} />}
        {/* Only when the service saved nothing (local server without a store): the report shows here instead of on its own page. */}
        {phase.kind === "done" && phase.outcome.ok && phase.outcome.id === null && <ReportView response={phase.outcome} elapsedMs={phase.elapsedMs} />}
      </div>
    </FocusFrame>
  );
}

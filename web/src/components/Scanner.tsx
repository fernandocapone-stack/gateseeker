import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, cn } from "@gateseeker/ui-kit";
import { ArrowRight, Loader2, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { scanRepository, type ScanOutcome, type ScanResponseOk } from "../api";
import { Link } from "../router";
import { ReportView } from "../views/Report";

/**
 * The product demo: paste a public GitHub URL, get the report on the same
 * page. Used on the Home page; the Get started page links back to it.
 */

type Phase = { kind: "idle" } | { kind: "running"; url: string; startedAt: number } | { kind: "done"; url: string; outcome: ScanOutcome; elapsedMs: number };

const PROGRESS = ["Checking the repository on GitHub", "Downloading the archive", "Reading the project files", "Querying OSV and the curated advisories", "Applying the priority rules"];

export function Scanner({ token, onResult }: { token: string | null; onResult?: (r: ScanResponseOk | null) => void }) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || phase.kind === "running") return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const startedAt = Date.now();
    setPhase({ kind: "running", url: trimmed, startedAt });
    onResult?.(null);
    const outcome = await scanRepository(trimmed, token, controller.signal);
    if (controller.signal.aborted) return;
    setPhase({ kind: "done", url: trimmed, outcome, elapsedMs: Date.now() - startedAt });
    onResult?.(outcome.ok ? outcome : null);
  }

  function cancel() {
    abort.current?.abort();
    setPhase({ kind: "idle" });
  }

  return (
    <div>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Repository URL"
          placeholder="https://github.com/owner/repository"
          value={url}
          onChange={(e) => { setUrl(e.target.value); }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          className="h-11 text-base sm:flex-1"
          disabled={phase.kind === "running"}
        />
        {phase.kind === "running" ? (
          <Button type="button" variant="outline" size="lg" className="h-11" onClick={cancel}>Cancel</Button>
        ) : (
          <Button type="submit" size="lg" className="h-11">
            Analyze <ArrowRight aria-hidden="true" />
          </Button>
        )}
      </form>
      <p className="mt-2 text-xs text-muted-foreground">Public repositories only, up to 50 MB compressed. Nothing is installed or executed. Reports stay in your account for 30 days.</p>

      <div className="mt-8">
        {phase.kind === "running" && <Progress startedAt={phase.startedAt} url={phase.url} />}
        {phase.kind === "done" && !phase.outcome.ok && <Refusal url={phase.url} code={phase.outcome.error.code} message={phase.outcome.error.message} />}
        {phase.kind === "done" && phase.outcome.ok && (
          <>
            <SavedNote response={phase.outcome} />
            <ReportView response={phase.outcome} elapsedMs={phase.elapsedMs} />
          </>
        )}
      </div>
    </div>
  );
}

function SavedNote({ response }: { response: ScanResponseOk }) {
  if (response.id === null) return null;
  const q = response.quota;
  return (
    <p className="mb-4 text-xs text-muted-foreground" data-testid="saved-note">
      {response.cached ? "Reused a report of this commit from the last 24 hours. " : ""}
      Saved as <Link href={`/r/${response.id}`} className="font-mono text-primary hover:underline">/r/{response.id}</Link> for 30 days.
      {q ? ` ${String(q.used)} of ${String(q.limit)} analyses used this hour.` : ""}
    </p>
  );
}

function Progress({ startedAt, url }: { startedAt: number; url: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { setTick((t) => t + 1); }, 1000);
    return () => { clearInterval(id); };
  }, []);
  const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const step = Math.min(PROGRESS.length - 1, Math.floor(elapsed / 6));
  return (
    <Card role="status" aria-live="polite">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
          Analyzing <span className="font-mono text-sm font-normal text-muted-foreground">{url}</span>
        </CardTitle>
        <CardDescription>
          {PROGRESS[step]}… {elapsed}s{tick > 90 ? " (large repositories can take up to two minutes)" : ""}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function Refusal({ url, code, message }: { url: string; code: string; message: string }) {
  const incomplete = code === "timeout" || code === "upstream-error" || code === "download-failed" || code === "store-unavailable";
  const limited = code === "rate-limited" || code === "unauthorized";
  return (
    <Card className={cn(incomplete || limited ? "border-warning/60" : "border-destructive/60")} role="alert">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {incomplete || limited ? <ShieldQuestion className="size-5 text-warning" aria-hidden="true" /> : <ShieldAlert className="size-5 text-destructive" aria-hidden="true" />}
          {limited ? (code === "rate-limited" ? "Hourly limit reached" : "Sign in required") : incomplete ? "Analysis incomplete" : "Could not analyze this URL"}
        </CardTitle>
        <CardDescription className="break-all font-mono text-xs">{url}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <p>{message}</p>
        {incomplete && <p className="mt-2 text-muted-foreground">An incomplete analysis is never reported as "no vulnerabilities". Try again in a moment, or run the CLI locally.</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          Error code <code>{code}</code>
        </p>
      </CardContent>
    </Card>
  );
}

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, IconInput, cn } from "@gateseeker/ui-kit";
import { ArrowRight, Loader2, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { scanRepository, type ScanOutcome, type ScanResponseOk } from "../api";
import { useAuth } from "../auth-context";
import { recordAnalysis } from "../history";
import { notify } from "../notifications";
import { Link } from "../router";
import { ReportView } from "../views/Report";
import { ReportSkeleton } from "./Skeletons";

/**
 * The product demo (Figma "Analyze Repository"): paste a public GitHub URL,
 * get the report on the same page. Used by the /app workspace.
 */

/* The scan icon of the Figma URL field, path copied from the export. */
function ScanIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 13.8889V15.4444C17 15.857 16.8361 16.2527 16.5444 16.5444C16.2527 16.8361 15.857 17 15.4444 17H4.55556C4.143 17 3.74733 16.8361 3.45561 16.5444C3.16389 16.2527 3 15.857 3 15.4444V13.8889M17 6.11111V4.55556C17 4.143 16.8361 3.74733 16.5444 3.45561C16.2527 3.16389 15.857 3 15.4444 3H4.55556C4.143 3 3.74733 3.16389 3.45561 3.45561C3.16389 3.74733 3 4.143 3 4.55556V6.11111M10.7778 10C10.7778 10.4296 10.4296 10.7778 10 10.7778C9.57045 10.7778 9.22222 10.4296 9.22222 10C9.22222 9.57045 9.57045 9.22222 10 9.22222C10.4296 9.22222 10.7778 9.57045 10.7778 10ZM15.4009 10.2567C15.459 10.0905 15.459 9.90951 15.4009 9.74333C14.963 8.67033 14.2154 7.75208 13.2535 7.10571C12.2916 6.45933 11.1589 6.11413 10 6.11413C8.84108 6.11413 7.70843 6.45933 6.74651 7.10571C5.78459 7.75208 5.03701 8.67033 4.59911 9.74333C4.54102 9.90951 4.54102 10.0905 4.59911 10.2567C5.03701 11.3297 5.78459 12.2479 6.74651 12.8943C7.70843 13.5407 8.84108 13.8859 10 13.8859C11.1589 13.8859 12.2916 13.5407 13.2535 12.8943C14.2154 12.2479 14.963 11.3297 15.4009 10.2567Z" />
    </svg>
  );
}

type Phase = { kind: "idle" } | { kind: "running"; url: string; startedAt: number } | { kind: "done"; url: string; outcome: ScanOutcome; elapsedMs: number };

const PROGRESS = ["Checking the repository on GitHub", "Downloading the archive", "Reading the project files", "Querying OSV and the curated advisories", "Applying the priority rules"];

export function Scanner({ token, heading, onResult }: { token: string | null; heading?: ReactNode; onResult?: (r: ScanResponseOk | null) => void }) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  const userId = useAuth().session?.user.id ?? null;

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
    if (userId) record(userId, trimmed, outcome);
    onResult?.(outcome.ok ? outcome : null);
  }

  function cancel() {
    abort.current?.abort();
    setPhase({ kind: "idle" });
  }

  return (
    <div className="grid gap-4">
      <Card className="flex flex-col gap-4 bg-transparent p-4 print:hidden">
        {heading}
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 sm:flex-row">
          <IconInput
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
            disabled={phase.kind === "running"}
          />
          {phase.kind === "running" ? (
            <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
          ) : (
            <Button type="submit">
              Analyze <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </form>
        <p className="text-caption text-muted-foreground">
          Public repositories only, up to <strong className="font-medium text-foreground">50MB</strong> compressed. Nothing is installed or executed. Reports stay in your account for 30 days.
        </p>
      </Card>

      <div>
        {phase.kind === "running" && (
          <div className="grid gap-4">
            <Progress startedAt={phase.startedAt} url={phase.url} />
            <ReportSkeleton />
          </div>
        )}
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

/* Errors the person sees at once while typing are not worth a notification. Every returned report also goes to the Dashboard history. */
const QUIET_CODES = new Set(["invalid-url", "bad-request", "unauthorized"]);
const INCOMPLETE_CODES = new Set(["timeout", "upstream-error", "download-failed", "store-unavailable"]);

function record(userId: string, url: string, outcome: ScanOutcome): void {
  if (outcome.ok) {
    const { report, repository } = outcome;
    recordAnalysis(userId, { owner: repository.owner, repo: repository.repo, sha: repository.sha.slice(0, 7), verdict: report.gate.verdict, byPriority: { ...report.summary.byPriority }, reportId: outcome.id });
    notify(userId, {
      kind: report.gate.verdict === "incomplete" ? "incomplete" : "finished",
      subject: `${repository.owner}/${repository.repo}@${repository.sha.slice(0, 7)}`,
      verdict: report.gate.verdict,
      p1: report.summary.byPriority.P1,
      p2: report.summary.byPriority.P2,
      reportId: outcome.id,
      message: report.gate.reason,
    });
    return;
  }
  if (QUIET_CODES.has(outcome.error.code)) return;
  notify(userId, {
    kind: INCOMPLETE_CODES.has(outcome.error.code) ? "incomplete" : "refused",
    subject: url,
    verdict: null,
    p1: 0,
    p2: 0,
    reportId: null,
    message: outcome.error.message,
  });
}

function SavedNote({ response }: { response: ScanResponseOk }) {
  if (response.id === null) return null;
  const q = response.quota;
  return (
    <p className="mb-4 text-label text-muted-foreground print:hidden" data-testid="saved-note">
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
          Analyzing <span className="font-mono text-label font-normal text-muted-foreground">{url}</span>
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
        <CardDescription className="break-all font-mono text-label">{url}</CardDescription>
      </CardHeader>
      <CardContent className="text-body">
        <p>{message}</p>
        {incomplete && <p className="mt-2 text-muted-foreground">An incomplete analysis is never reported as "no vulnerabilities". Try again in a moment, or run the CLI locally.</p>}
        <p className="mt-3 text-label text-muted-foreground">
          Error code <code>{code}</code>
        </p>
      </CardContent>
    </Card>
  );
}

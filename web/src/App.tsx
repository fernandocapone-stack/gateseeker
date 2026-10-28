import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, cn } from "@gateseeker/ui-kit";
import { ArrowRight, GitBranch, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion, Terminal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { scanRepository, type ScanOutcome, type ScanResponseOk } from "./api";
import { ReportView } from "./views/Report";

type Phase = { kind: "idle" } | { kind: "running"; url: string; startedAt: number } | { kind: "done"; url: string; outcome: ScanOutcome; elapsedMs: number };

const PROGRESS = ["Checking the repository on GitHub", "Downloading the archive", "Reading the project files", "Querying OSV and the curated advisories", "Applying the priority rules"];

export function App() {
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
    const outcome = await scanRepository(trimmed, controller.signal);
    if (controller.signal.aborted) return;
    setPhase({ kind: "done", url: trimmed, outcome, elapsedMs: Date.now() - startedAt });
  }

  function cancel() {
    abort.current?.abort();
    setPhase({ kind: "idle" });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <a href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Gateseeker
          </a>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <a href="#ci" className="hover:text-foreground">Use in CI</a>
            <a href="#limits" className="hover:text-foreground">What it covers</a>
            <a href="https://github.com/gateseeker-dev/gateseeker" className="hover:text-foreground" rel="noreferrer">GitHub</a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <section className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Security gate for AI-generated code.</h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground">
            Paste the URL of a public GitHub repository. Gateseeker reads it (never runs it), checks the installed dependencies against OSV and a curated advisory feed, looks for the insecure patterns common in vibe-coded apps, and ranks every finding with explainable rules.
          </p>
          <form onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-2 sm:flex-row">
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
          <p className="mt-2 text-xs text-muted-foreground">Public repositories only, up to 100 MB. Nothing is installed or executed. Reports are not stored in this preview.</p>
        </section>

        {phase.kind === "running" && <Progress startedAt={phase.startedAt} url={phase.url} />}
        {phase.kind === "done" && !phase.outcome.ok && <Refusal url={phase.url} code={phase.outcome.error.code} message={phase.outcome.error.message} />}
        {phase.kind === "done" && phase.outcome.ok && <ReportView response={phase.outcome} elapsedMs={phase.elapsedMs} />}

        <UseInCi repository={phase.kind === "done" && phase.outcome.ok ? phase.outcome.repository : null} />
        <Limits />
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-4 py-6 text-xs text-muted-foreground">
          Gateseeker is open source (MIT). "No known vulnerabilities" means none was returned by the sources consulted at query time, not that a project is secure.
        </div>
      </footer>
    </div>
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
    <Card role="status" aria-live="polite" className="mb-10">
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
  const incomplete = code === "timeout" || code === "upstream-error" || code === "download-failed";
  return (
    <Card className={cn("mb-10", incomplete ? "border-warning/60" : "border-destructive/60")} role="alert">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {incomplete ? <ShieldQuestion className="size-5 text-warning" aria-hidden="true" /> : <ShieldAlert className="size-5 text-destructive" aria-hidden="true" />}
          {incomplete ? "Analysis incomplete" : "Could not analyze this URL"}
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

function UseInCi({ repository }: { repository: ScanResponseOk["repository"] | null }) {
  const yaml = `# .github/workflows/gateseeker.yml
name: Gateseeker
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
  security-events: write
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: gateseeker-dev/gateseeker@v1
        with:
          fail-on: P2`;
  return (
    <section id="ci" className="mb-10 scroll-mt-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="size-5 text-primary" aria-hidden="true" />
            Make it a gate: run this on every pull request
          </CardTitle>
          <CardDescription>
            {repository ? `Add this workflow to ${repository.owner}/${repository.repo} and ` : "Add this workflow to your repository and "}
            every pull request gets a summary comment, SARIF results in the Security tab, and a failing check when a P1 or P2 finding appears. No account, no token: it uses the GitHub token the workflow already has.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border bg-input p-4 font-mono text-xs leading-relaxed inset-shadow-solid"><code>{yaml}</code></pre>
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Terminal className="size-4" aria-hidden="true" />
            Or locally: <code className="rounded bg-muted px-1.5 py-0.5">npx gateseeker@beta scan .</code>
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function Limits() {
  return (
    <section id="limits" className="mb-10 scroll-mt-6">
      <Card>
        <CardHeader>
          <CardTitle>What this analysis covers, and what it does not</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <h3 className="mb-2 font-medium">Covers</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Known vulnerabilities in installed npm (<code>package-lock.json</code> v2/v3) and Composer (<code>composer.lock</code>) dependencies, from OSV.</li>
              <li>A curated, human-approved advisory feed for incidents official databases miss, such as tag rewrites on Packagist.</li>
              <li>Structural supply-chain signals in the lockfile: new install-time code, unverifiable sources, suspicious release timing.</li>
              <li>Eight code-pattern rules for the mistakes most common in AI-generated apps: hardcoded credentials, Supabase keys and disabled RLS, Firebase config, open CORS with credentials, committed <code>.env</code> files, debug builds.</li>
              <li>A priority (P1 to P4) for every finding, from documented rules you can audit, never from a model.</li>
            </ul>
          </div>
          <div>
            <h3 className="mb-2 font-medium">Does not cover</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Private repositories, GitLab, Bitbucket, or anything above 100 MB (use the CLI locally).</li>
              <li>Whether vulnerable code is actually reachable; data-flow analysis; injection and missing authorization in general.</li>
              <li>Runtime behaviour, infrastructure, or anything that requires executing the project. Nothing is ever executed.</li>
              <li>Dependencies without a lockfile, workspace or linked packages, and non-semver versions (these are declared, not silently skipped).</li>
              <li>An incident absent from both OSV and the curated feed. "No known vulnerabilities" always means "in the sources consulted".</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

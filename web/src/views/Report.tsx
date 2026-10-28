import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from "@gateseeker/ui-kit";
import { ChevronDown, ExternalLink, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useState } from "react";

import type { Finding, ScanResponseOk } from "../api";

/**
 * The report as a page. Everything shown comes from the JSON the CLI would
 * produce; package names, summaries and snippets are rendered as text nodes
 * (React escapes them) and never turned into links or HTML. The only links
 * are the references the sources provide, and only when they are http(s).
 */

const PRIORITY_LABEL: Record<string, string> = { P1: "Fix now", P2: "Fix before release", P3: "Plan a fix", P4: "Keep an eye on it" };

function severityVariant(tier: string): "critical" | "high" | "moderate" | "low" | "secondary" {
  const t = tier.toUpperCase();
  if (t === "CRITICAL") return "critical";
  if (t === "HIGH") return "high";
  if (t === "MODERATE" || t === "MEDIUM") return "moderate";
  if (t === "LOW") return "low";
  return "secondary";
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function ReportView({ response, elapsedMs }: { response: ScanResponseOk; elapsedMs: number }) {
  const { report, repository, archive } = response;
  const verdict = report.gate.verdict;
  const Icon = verdict === "pass" ? ShieldCheck : verdict === "fail" ? ShieldAlert : ShieldQuestion;
  const tone = verdict === "pass" ? "text-success" : verdict === "fail" ? "text-destructive" : "text-warning";
  const border = verdict === "pass" ? "border-success/60" : verdict === "fail" ? "border-destructive/60" : "border-warning/60";
  const p = report.summary.byPriority;
  const k = report.summary.byKind;
  const sorted = [...report.findings].sort((a, b) => a.priority.localeCompare(b.priority));

  return (
    <section className="mb-10" aria-label="Report">
      <Card className={cn(border)}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <Icon className={cn("size-6", tone)} aria-hidden="true" />
            <span className={tone}>{verdict === "pass" ? "PASS" : verdict === "fail" ? "FAIL" : "INCOMPLETE"}</span>
            <span className="font-mono text-sm font-normal text-muted-foreground">
              {repository.owner}/{repository.repo}@{repository.sha.slice(0, 7)}
            </span>
          </CardTitle>
          <CardDescription>{report.gate.reason}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["P1", "P2", "P3", "P4"] as const).map((pr) => (
              <div key={pr} className="rounded-md border bg-background p-3">
                <dt className="text-xs text-muted-foreground">
                  {pr} · {PRIORITY_LABEL[pr]}
                </dt>
                <dd className="text-2xl font-semibold tabular-nums">{p[pr]}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">
            Dependencies {k["dependency-vulnerability"]} · supply chain {k["supply-chain-anomaly"]} · code patterns {k["insecure-pattern"]} · gate: fail on {report.gate.failOn}, patterns {report.gate.patternsMode}, supply-chain rules {report.gate.supplyChainMode}
          </p>
          <p className="text-sm text-muted-foreground">
            {report.analyses.dependencies === "analyzed"
              ? `Queried ${report.summary.queried} dependency version(s): ${report.summary.byQueryState.vulnerable} with known issues, ${report.summary.byQueryState["no-known-vulnerabilities"]} without, ${report.summary.byQueryState["query-failed"]} failed, ${report.summary.byQueryState["not-queried"]} not queried.`
              : "Dependencies were not analyzed: no package-lock.json or composer.lock at the repository root."}{" "}
            {report.analyses.patterns === "analyzed" && report.patterns ? `${report.patterns.filesScanned} file(s) scanned for code patterns.` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {archive.files} files read{archive.skippedLarge > 0 ? ` (${archive.skippedLarge} large binary file(s) skipped)` : ""} · {(elapsedMs / 1000).toFixed(1)}s · Gateseeker {report.gateseekerVersion} · sources: {report.sources.map((s) => s.name).join(", ") || "none"}
          </p>
        </CardContent>
      </Card>

      {sorted.length > 0 ? (
        <ol className="mt-4 grid gap-3" aria-label="Findings">
          {sorted.map((f) => (
            <li key={f.id}>
              <FindingCard finding={f} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No known vulnerabilities or insecure patterns were found in the sources consulted.</p>
      )}

      {report.errors.length > 0 && (
        <details className="mt-4 rounded-md border p-3 text-sm">
          <summary className="cursor-pointer">Errors and warnings ({report.errors.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {report.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      <details className="mt-3 rounded-md border p-3 text-sm">
        <summary className="cursor-pointer">Limitations</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          {report.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function FindingCard({ finding: f }: { finding: Finding }) {
  const [open, setOpen] = useState(f.priority === "P1");
  const e = f.evidence;
  const title = e.kind === "insecure-pattern" ? `${e.ruleId}: ${e.title}` : e.kind === "supply-chain-anomaly" ? `${e.origin === "advisory" ? e.advisoryId ?? "" : e.ruleId ?? ""}: ${e.type}` : `${e.vulnerabilityId}${e.aliases[0] ? ` (${e.aliases[0]})` : ""}: ${e.summary ?? ""}`;
  return (
    <Card>
      <button type="button" className="flex w-full items-start gap-3 p-4 text-left" onClick={() => { setOpen((o) => !o); }} aria-expanded={open}>
        <Badge variant={f.priority === "P1" ? "critical" : f.priority === "P2" ? "high" : f.priority === "P3" ? "moderate" : "low"} className="mt-0.5 shrink-0">
          {f.priority}
        </Badge>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{f.subject}</span>
            <Badge variant={severityVariant(f.severity.tier)}>{f.severity.tier}</Badge>
            <Badge variant="outline">{e.kind === "insecure-pattern" ? "code pattern" : e.kind === "supply-chain-anomaly" ? "supply chain" : "dependency"}</Badge>
          </div>
          <p className="mt-1 text-sm">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{f.remediation.action}</p>
        </div>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <CardContent className="grid gap-3 border-t pt-4 text-sm">
          {e.kind === "insecure-pattern" && (
            <div>
              <p className="text-muted-foreground">
                <span className="font-mono">{e.file}:{e.line}</span> · classified as {e.fileClass}
              </p>
              <pre className="mt-2 overflow-x-auto rounded-md border bg-input p-3 font-mono text-xs inset-shadow-solid"><code>{e.snippet}</code></pre>
              <p className="mt-2">{e.message}</p>
            </div>
          )}
          {e.kind === "supply-chain-anomaly" && (
            <div>
              <p>{e.summary}</p>
              {e.indicators.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                  {e.indicators.map((i, n) => (
                    <li key={n} className="font-mono text-xs">{i}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Verification: {e.verification}
                {e.reviewedBy ? ` · reviewed by ${e.reviewedBy}` : ""}
              </p>
            </div>
          )}
          {e.kind === "dependency-vulnerability" && (
            <div>
              {e.details && <p className="whitespace-pre-wrap text-muted-foreground">{e.details.slice(0, 1200)}{e.details.length > 1200 ? "…" : ""}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                Published {e.published ?? "unknown"} · source {f.source.name}
                {f.remediation.fixedVersions.length > 0 ? ` · fixed in ${f.remediation.fixedVersions.join(", ")}` : " · no fixed version published"}
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Why this priority: <span className="font-mono">{f.rationale.join(" → ")}</span>
          </p>
          {f.references.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {f.references.slice(0, 6).map((r, n) => {
                const href = safeHref(r.url);
                return (
                  <li key={n}>
                    {href ? (
                      <a href={href} rel="noreferrer noopener" target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
                        {r.type} <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{r.type}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      )}
    </Card>
  );
}

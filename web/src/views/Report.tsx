import { Badge, Button, Card, Logo, MetricCard, Segmented, Table, Td, Th, cn } from "@gateseeker/ui-kit";
import { renderPdf } from "gateseeker/dist/report/pdf.js";
import { ArrowUpDown, Download, ExternalLink, Printer, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

import type { Finding, ScanResponseOk } from "../api";

/**
 * The report as a page: verdict, one KPI card per priority and the Issues
 * table (Figma "Issues"). Everything shown comes from the JSON the CLI would
 * produce; package names, summaries and snippets are rendered as text nodes
 * (React escapes them) and never turned into links or HTML. The only links
 * are the references the sources provide, and only when they are http(s).
 *
 * "Download PDF" saves a file built by the engine's own PDF writer
 * (src/report/pdf.ts, no dependency): the whole report as a plain document.
 * "Print" prints the page with the paper palette from theme.css: the
 * workspace frame and the controls are hidden, every finding is expanded and
 * the filter is ignored, so a printout always carries the whole report.
 */

const PRIORITY_LABEL: Record<string, string> = { P1: "Fix now", P2: "Fix before release", P3: "Plan a fix", P4: "Keep an eye on it" };
const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
type Filter = "all" | (typeof PRIORITIES)[number];
type Sort = "priority" | "severity";
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2, MEDIUM: 2, LOW: 3 };

function severityVariant(tier: string): "critical" | "high" | "moderate" | "low" {
  const t = tier.toUpperCase();
  if (t === "CRITICAL") return "critical";
  if (t === "HIGH") return "high";
  if (t === "MODERATE" || t === "MEDIUM") return "moderate";
  return "low";
}

function kindLabel(f: Finding): string {
  return f.evidence.kind === "insecure-pattern" ? "code pattern" : f.evidence.kind === "supply-chain-anomaly" ? "supply chain" : "dependency";
}

function findingTitle(f: Finding): string {
  const e = f.evidence;
  if (e.kind === "insecure-pattern") return `${e.ruleId}: ${e.title}`;
  if (e.kind === "supply-chain-anomaly") return `${e.origin === "advisory" ? e.advisoryId ?? "" : e.ruleId ?? ""}: ${e.type}`;
  return `${e.vulnerabilityId}${e.aliases[0] ? ` (${e.aliases[0]})` : ""}: ${e.summary ?? ""}`;
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** True between the browser's beforeprint and afterprint events. */
function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    // flushSync: the browser snapshots the page right after beforeprint, so the expanded rows must be in the DOM by then.
    const on = () => { flushSync(() => { setPrinting(true); }); };
    const off = () => { setPrinting(false); };
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
    };
  }, []);
  return printing;
}

/** Builds the PDF in the browser and saves it; nothing is sent anywhere. */
function downloadPdf(response: ScanResponseOk, elapsedMs: number): void {
  const { report, repository, archive } = response;
  const sha = repository.sha.slice(0, 7);
  const bytes = renderPdf(report, {
    subject: `${repository.owner}/${repository.repo}@${sha}`,
    exportedAt: new Date(),
    notes: [`${String(archive.files)} files read`, `${(elapsedMs / 1000).toFixed(1)}s`],
  });
  const name = `gateseeker-${repository.owner}-${repository.repo}-${sha}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_");
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function kindNote(list: Finding[]): string {
  if (list.length === 0) return "nothing here";
  const count = (k: Finding["evidence"]["kind"]) => list.filter((f) => f.evidence.kind === k).length;
  const parts = [
    count("insecure-pattern") > 0 ? plural(count("insecure-pattern"), "code pattern", "code patterns") : null,
    count("dependency-vulnerability") > 0 ? plural(count("dependency-vulnerability"), "dependency", "dependencies") : null,
    count("supply-chain-anomaly") > 0 ? plural(count("supply-chain-anomaly"), "supply chain", "supply chain") : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function ReportView({ response, elapsedMs }: { response: ScanResponseOk; elapsedMs: number }) {
  const { report, repository, archive } = response;
  const printing = usePrinting();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("priority");

  const verdict = report.gate.verdict;
  const Icon = verdict === "pass" ? ShieldCheck : verdict === "fail" ? ShieldAlert : ShieldQuestion;
  const tone = verdict === "pass" ? "text-success" : verdict === "fail" ? "text-destructive" : "text-warning";
  const k = report.summary.byKind;
  const slug = `${repository.owner}/${repository.repo}@${repository.sha.slice(0, 7)}`;

  const bySeverity = (a: Finding, b: Finding) => (SEVERITY_RANK[a.severity.tier.toUpperCase()] ?? 9) - (SEVERITY_RANK[b.severity.tier.toUpperCase()] ?? 9);
  const ordered = [...report.findings].sort((a, b) =>
    sort === "priority" ? a.priority.localeCompare(b.priority) || bySeverity(a, b) : bySeverity(a, b) || a.priority.localeCompare(b.priority),
  );
  const visible = printing || filter === "all" ? ordered : ordered.filter((f) => f.priority === filter);

  return (
    <section className="grid gap-4" aria-label="Report">
      <div className="hidden items-center justify-between border-b pb-3 print:flex">
        <Logo />
        <p className="text-label text-muted-foreground">Report exported {new Date().toLocaleString()}</p>
      </div>

      <Card className="grid gap-2 p-4">
        <p className="flex flex-wrap items-center gap-2 text-title font-medium">
          <Icon className={cn("size-5", tone)} aria-hidden="true" />
          <span className={tone}>{verdict === "pass" ? "PASS" : verdict === "fail" ? "FAIL" : "INCOMPLETE"}</span>
          <span className="font-mono text-label font-normal text-muted-foreground">{slug}</span>
        </p>
        <p className="text-body">{report.gate.reason}</p>
        <p className="text-label text-muted-foreground">
          {report.analyses.dependencies === "analyzed"
            ? `Queried ${String(report.summary.queried)} dependency version(s): ${String(report.summary.byQueryState.vulnerable)} with known issues, ${String(report.summary.byQueryState["no-known-vulnerabilities"])} without, ${String(report.summary.byQueryState["query-failed"])} failed, ${String(report.summary.byQueryState["not-queried"])} not queried.`
            : report.analyses.dependencies === "not-supported"
              ? `Dependencies were not analyzed: ${(report.project.unsupportedLockfiles ?? []).join(", ")} is not supported yet, so the result is incomplete.`
              : "Dependencies were not analyzed: no package-lock.json or composer.lock at the repository root."}{" "}
          {report.analyses.patterns === "analyzed" && report.patterns ? `${String(report.patterns.filesScanned)} file(s) scanned for code patterns.` : ""}
        </p>
        <p className="text-caption text-muted-foreground">
          Dependencies {k["dependency-vulnerability"]} · supply chain {k["supply-chain-anomaly"]} · code patterns {k["insecure-pattern"]} · gate: fail on {report.gate.failOn}, patterns {report.gate.patternsMode}, supply-chain rules {report.gate.supplyChainMode} · {archive.files} files read{archive.skippedLarge > 0 ? ` (${String(archive.skippedLarge)} large binary file(s) skipped)` : ""} · {(elapsedMs / 1000).toFixed(1)}s · Gateseeker {report.gateseekerVersion} · sources: {report.sources.map((s) => s.name).join(", ") || "none"}
        </p>
      </Card>

      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4 print:grid-cols-4">
        {PRIORITIES.map((pr) => (
          <div key={pr}>
            <dt className="sr-only">{pr} · {PRIORITY_LABEL[pr]}</dt>
            <dd>
              <MetricCard label={`${pr} · ${PRIORITY_LABEL[pr]}`} value={report.summary.byPriority[pr]} note={kindNote(report.findings.filter((f) => f.priority === pr))} className="h-full" />
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          <Segmented<Filter>
            label="Filter by priority"
            value={filter}
            onChange={setFilter}
            options={[{ value: "all", label: "All" }, ...PRIORITIES.map((p) => ({ value: p, label: `${p} (${String(report.summary.byPriority[p])})` }))]}
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="pr-2 text-label" onClick={() => { setSort((s) => (s === "priority" ? "severity" : "priority")); }}>
              {sort === "priority" ? "Highest priority" : "Highest severity"} <ArrowUpDown className="text-primary" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="sm" className="pr-2 text-label" onClick={() => { downloadPdf(response, elapsedMs); }}>
              Download PDF <Download className="text-primary" aria-hidden="true" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Print" title="Print" onClick={() => { window.print(); }}>
              <Printer className="text-primary" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <h2 className="sr-only">Issues</h2>
        <Table aria-label="Findings">
          <thead>
            <tr>
              <Th>Issue</Th>
              <Th className="w-32">Priority</Th>
              <Th className="w-36">Source</Th>
              <Th className="w-[119px] print:hidden">Action</Th>
            </tr>
          </thead>
          <tbody className="[&>tr:nth-last-child(2)]:border-b-0">
            {visible.length > 0 ? (
              visible.map((f) => <FindingRow key={f.id} finding={f} printing={printing} />)
            ) : (
              <tr>
                <Td colSpan={4} className="text-body text-muted-foreground">
                  {report.findings.length === 0 ? "No known vulnerabilities or insecure patterns were found in the sources consulted." : "No findings with this priority."}
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>

      {report.errors.length > 0 && (
        <details key={printing ? "print-errors" : "errors"} open={printing} className="rounded-lg border bg-sidebar p-4 text-body">
          <summary className="cursor-pointer font-medium">Errors and warnings ({report.errors.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-label text-muted-foreground">
            {report.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      <details key={printing ? "print-limits" : "limits"} open={printing} className="rounded-lg border bg-sidebar p-4 text-body">
        <summary className="cursor-pointer font-medium">Limitations</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-label text-muted-foreground">
          {report.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </details>
      <p className="hidden text-caption text-muted-foreground print:block">
        "No known vulnerabilities" means none was returned by the sources consulted at query time, not that a project is secure.
      </p>
    </section>
  );
}

function FindingRow({ finding: f, printing }: { finding: Finding; printing: boolean }) {
  const [open, setOpen] = useState(false);
  const e = f.evidence;
  const detailId = `finding-${f.id}`;
  const expanded = open || printing;
  return (
    <>
      <tr className={cn("border-b last:border-b-0 print:break-inside-avoid", expanded && "border-b-0")}>
        <Td>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-label font-light break-all text-muted-foreground">{f.subject}</span>
              <Badge variant={severityVariant(f.severity.tier)}>{f.severity.tier}</Badge>
              <Badge variant="kind">{kindLabel(f)}</Badge>
            </div>
            <div className="grid gap-0.5">
              <p className="text-body font-medium">{findingTitle(f)}</p>
              <p className="text-label font-light text-muted-foreground">{f.remediation.action}</p>
            </div>
          </div>
        </Td>
        <Td className="text-body">
          <span className="font-medium">{f.priority}</span>
          <span className="block text-label text-muted-foreground">{PRIORITY_LABEL[f.priority]}</span>
        </Td>
        <Td className="text-body whitespace-nowrap text-muted-foreground">{f.source.name}</Td>
        <Td className="print:hidden">
          <Button variant="outline" size="md" aria-expanded={expanded} aria-controls={detailId} onClick={() => { setOpen((o) => !o); }}>
            {open ? "Hide issue" : "View issue"}
          </Button>
        </Td>
      </tr>
      <tr id={detailId} className={cn("border-b last:border-b-0", !expanded && "hidden")}>
        <td colSpan={4} className="px-3 pb-4 pl-3">
          <div className="grid gap-3 rounded-md border bg-background p-4 text-body print:bg-transparent">
            {e.kind === "insecure-pattern" && (
              <div>
                <p className="text-label text-muted-foreground">
                  <span className="font-mono">{e.file}:{e.line}</span> · classified as {e.fileClass}
                </p>
                <pre className="mt-2 overflow-x-auto rounded-md border bg-input p-3 font-mono text-label whitespace-pre-wrap print:break-all"><code>{e.snippet}</code></pre>
                <p className="mt-2">{e.message}</p>
              </div>
            )}
            {e.kind === "supply-chain-anomaly" && (
              <div>
                <p>{e.summary}</p>
                {e.indicators.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {e.indicators.map((i, n) => (
                      <li key={n} className="font-mono text-label">{i}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-label text-muted-foreground">
                  Verification: {e.verification}
                  {e.reviewedBy ? ` · reviewed by ${e.reviewedBy}` : ""}
                </p>
              </div>
            )}
            {e.kind === "dependency-vulnerability" && (
              <div>
                {e.details && <p className="whitespace-pre-wrap text-muted-foreground">{e.details.slice(0, 1200)}{e.details.length > 1200 ? "…" : ""}</p>}
                <p className="mt-2 text-label text-muted-foreground">
                  Published {e.published ?? "unknown"} · source {f.source.name}
                  {f.remediation.fixedVersions.length > 0 ? ` · fixed in ${f.remediation.fixedVersions.join(", ")}` : " · no fixed version published"}
                </p>
              </div>
            )}
            <p className="text-label text-muted-foreground">
              Why this priority: <span className="font-mono">{f.rationale.join(" → ")}</span>
            </p>
            {f.references.length > 0 && (
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-label">
                {f.references.slice(0, 6).map((r, n) => {
                  const href = safeHref(r.url);
                  return (
                    <li key={n}>
                      {href ? (
                        <a href={href} rel="noreferrer noopener" target="_blank" className="inline-flex items-center gap-1 text-primary hover:underline">
                          {r.type} <ExternalLink className="size-3" aria-hidden="true" />
                          <span className="hidden print:inline print:break-all"> {href}</span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{r.type}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

import { Badge, Button, Card, Logo, MetricCard, Segmented, cn } from "@gateseeker/ui-kit";
import { PRIORITY_LABEL } from "gateseeker/dist/report/labels.js";
import { renderPdf } from "gateseeker/dist/report/pdf.js";
import { ArrowUpDown, ChevronDown, Download, ExternalLink, Printer, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

import type { Finding, ScanResponseOk } from "../api";
import { FixGuidance } from "../components/FixGuidance";

/**
 * The report as a page. Built for a reader who is not a security specialist
 * (PO review, 2026-10-31):
 *
 *  - the headline says what to fix ("14 to fix now"), never a green PASS
 *    over urgent findings; the CI gate verdict is a secondary line that
 *    explains itself (code checks run in warning mode);
 *  - one plain summary line, with the technical numbers under "Technical
 *    details";
 *  - findings with the same rule or advisory are grouped ("5 places");
 *  - each row shows what could happen and a "How to fix" button; the first
 *    group to fix is marked "Start here";
 *  - rows are a responsive list, not a table, so they read as cards on a
 *    phone.
 *
 * Everything shown comes from the JSON the CLI would produce; package
 * names, summaries and snippets are rendered as text nodes (React escapes
 * them) and never turned into links or HTML. The only links are the
 * references the sources provide, and only when they are http(s).
 *
 * "Download PDF" saves a file built by the engine's own PDF writer; "Print"
 * prints the page with the paper palette from theme.css, every group and
 * finding expanded and the filter ignored.
 */

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

/** One line under the title: what could happen, or the action when the rule has no impact text. */
function oneLiner(f: Finding): string {
  return f.remediation.impact ?? f.remediation.action;
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

interface Group {
  key: string;
  findings: Finding[];
}

/** Same rule or advisory at the same priority -> one group, in the order of the first member. */
function groupFindings(ordered: Finding[]): Group[] {
  const groups = new Map<string, Group>();
  for (const f of ordered) {
    const key = `${f.priority}|${findingTitle(f)}`;
    const g = groups.get(key);
    if (g) g.findings.push(f);
    else groups.set(key, { key, findings: [f] });
  }
  return [...groups.values()];
}

function Headline({ response, elapsedMs, printing }: { response: ScanResponseOk; elapsedMs: number; printing: boolean }) {
  const { report, repository, archive } = response;
  const verdict = report.gate.verdict;
  const p = report.summary.byPriority;
  const urgent = p.P1 + p.P2;
  const slug = `${repository.owner}/${repository.repo}@${repository.sha.slice(0, 7)}`;
  const k = report.summary.byKind;
  const patternUrgent = report.findings.some((f) => f.evidence.kind === "insecure-pattern" && (f.priority === "P1" || f.priority === "P2"));

  const Icon = urgent > 0 ? ShieldAlert : verdict === "incomplete" ? ShieldQuestion : ShieldCheck;
  const tone = urgent > 0 ? (p.P1 > 0 ? "text-destructive" : "text-warning") : verdict === "incomplete" ? "text-warning" : "text-success";
  const title =
    urgent > 0
      ? [p.P1 > 0 ? `${String(p.P1)} to fix now` : null, p.P2 > 0 ? `${String(p.P2)} to fix before release` : null].filter(Boolean).join(" · ")
      : verdict === "incomplete"
        ? "Some checks could not run"
        : "Nothing to fix now or before release";

  const gate =
    verdict === "fail"
      ? `CI gate: would block the merge (findings at ${report.gate.failOn} or higher).`
      : verdict === "incomplete"
        ? "CI gate: incomplete. An unfinished check is never reported as clean."
        : patternUrgent && report.gate.patternsMode === "warn"
          ? "CI gate: would pass, because code checks run in warning mode and don't block merges yet. They still need fixing."
          : `CI gate: would pass. No known vulnerabilities at ${report.gate.failOn} or higher were found in the sources consulted.`;

  const checked = [
    report.analyses.dependencies === "analyzed" ? plural(report.summary.dependencies, "dependency", "dependencies") : null,
    report.analyses.patterns === "analyzed" && report.patterns ? plural(report.patterns.filesScanned, "file", "files") : null,
  ].filter(Boolean);

  return (
    <Card className="grid gap-2 p-4">
      <p className="flex flex-wrap items-center gap-2 text-title font-medium">
        <Icon className={cn("size-5", tone)} aria-hidden="true" />
        <span className={tone} data-testid="headline">{title}</span>
        <span className="font-mono text-label font-normal text-muted-foreground">{slug}</span>
      </p>
      <p className="text-body" data-testid="gate-line">{gate}</p>
      {verdict === "incomplete" && urgent > 0 && <p className="text-body text-warning">Some checks could not run, so this result is incomplete. See Technical details.</p>}
      <p className="text-label text-muted-foreground">
        {checked.length > 0 ? `Checked ${checked.join(" and ")} in ${(elapsedMs / 1000).toFixed(1)} s.` : "No dependencies or code were analyzed."}
        {report.analyses.dependencies === "not-supported" ? ` Dependencies were not analyzed: ${(report.project.unsupportedLockfiles ?? []).join(", ")} is not supported yet.` : ""}
        {report.analyses.dependencies === "not-analyzed" ? " No supported lockfile at the repository root, so dependencies were not analyzed." : ""}
      </p>
      <details key={printing ? "print-tech" : "tech"} open={printing} className="text-label text-muted-foreground">
        <summary className="cursor-pointer select-none">Technical details</summary>
        <div className="mt-2 grid gap-1.5">
          <p>Gate: {report.gate.verdict.toUpperCase()}. {report.gate.reason}</p>
          {report.analyses.dependencies === "analyzed" && (
            <p>
              Queried {report.summary.queried} dependency version(s): {report.summary.byQueryState.vulnerable} with known issues, {report.summary.byQueryState["no-known-vulnerabilities"]} without, {report.summary.byQueryState["query-failed"]} failed, {report.summary.byQueryState["not-queried"]} not queried.
            </p>
          )}
          <p className="text-caption">
            Dependencies {k["dependency-vulnerability"]} · supply chain {k["supply-chain-anomaly"]} · code patterns {k["insecure-pattern"]} · gate: fail on {report.gate.failOn}, patterns {report.gate.patternsMode}, supply-chain rules {report.gate.supplyChainMode} · {archive.files} files read{archive.skippedLarge > 0 ? ` (${String(archive.skippedLarge)} large binary file(s) skipped)` : ""}{archive.skippedLinks ? ` · ${String(archive.skippedLinks)} link(s) not read` : ""} · Gateseeker {report.gateseekerVersion} · sources: {report.sources.map((s) => s.name).join(", ") || "none"}
          </p>
        </div>
      </details>
    </Card>
  );
}

export function ReportView({ response, elapsedMs, newIds }: { response: ScanResponseOk; elapsedMs: number; newIds?: Set<string> }) {
  const { report } = response;
  const printing = usePrinting();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("priority");

  const bySeverity = (a: Finding, b: Finding) => (SEVERITY_RANK[a.severity.tier.toUpperCase()] ?? 9) - (SEVERITY_RANK[b.severity.tier.toUpperCase()] ?? 9);
  const ordered = [...report.findings].sort((a, b) =>
    sort === "priority" ? a.priority.localeCompare(b.priority) || bySeverity(a, b) : bySeverity(a, b) || a.priority.localeCompare(b.priority),
  );
  const visible = printing || filter === "all" ? ordered : ordered.filter((f) => f.priority === filter);
  const groups = groupFindings(visible);
  // "Start here": the first group of the whole report by priority, when it is urgent.
  const firstUrgent = groupFindings([...report.findings].sort((a, b) => a.priority.localeCompare(b.priority) || bySeverity(a, b)))[0];
  const startKey = firstUrgent && (firstUrgent.findings[0]?.priority === "P1" || firstUrgent.findings[0]?.priority === "P2") ? firstUrgent.key : null;

  return (
    <section className="grid gap-4" aria-label="Report">
      <div className="hidden items-center justify-between border-b pb-3 print:flex">
        <Logo />
        <p className="text-label text-muted-foreground">Report exported {new Date().toLocaleString()}</p>
      </div>

      <Headline response={response} elapsedMs={elapsedMs} printing={printing} />

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
          <div className="flex flex-wrap items-center gap-2">
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
        <ul aria-label="Findings" className="overflow-hidden rounded-lg border bg-sidebar">
          {groups.length > 0 ? (
            groups.map((g) => <IssueGroup key={g.key} group={g} printing={printing} startHere={g.key === startKey} newIds={newIds} />)
          ) : (
            <li className="px-3 py-4 text-body text-muted-foreground">
              {report.findings.length === 0 ? "No known vulnerabilities or insecure patterns were found in the sources consulted." : "No findings with this priority."}
            </li>
          )}
        </ul>
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

function Labels({ f, startHere, isNew }: { f: Finding; startHere: boolean; isNew: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {startHere && <Badge variant="kind" className="border-primary/50 text-primary">Start here</Badge>}
      {isNew && <Badge variant="critical">New</Badge>}
      <Badge variant={severityVariant(f.severity.tier)}>{f.severity.tier}</Badge>
      <Badge variant="kind">{kindLabel(f)}</Badge>
    </div>
  );
}

function PriorityCell({ f }: { f: Finding }) {
  return (
    <div className="text-body sm:w-32 sm:shrink-0">
      <span className="font-medium">{f.priority}</span>
      <span className="ml-1.5 text-label text-muted-foreground sm:ml-0 sm:block">{PRIORITY_LABEL[f.priority]}</span>
    </div>
  );
}

function IssueGroup({ group, printing, startHere, newIds }: { group: Group; printing: boolean; startHere: boolean; newIds?: Set<string> }) {
  const [open, setOpen] = useState(false);
  const first = group.findings[0];
  if (!first) return null;
  if (group.findings.length === 1) return <IssueRow finding={first} printing={printing} startHere={startHere} isNew={newIds?.has(first.id) ?? false} />;
  const id = `group-${first.id}`;
  const expanded = open || printing;
  return (
    <li className="border-b last:border-b-0 print:break-inside-avoid">
      <div className="flex flex-col gap-3 px-3 py-4 sm:flex-row sm:items-start sm:gap-4">
        <div className="grid min-w-0 flex-1 gap-2">
          <Labels f={first} startHere={startHere} isNew={group.findings.some((f) => newIds?.has(f.id))} />
          <div className="grid gap-0.5">
            <p className="text-body font-medium break-words">{findingTitle(first)}</p>
            <p className="text-label font-light text-muted-foreground">{oneLiner(first)}</p>
            <p className="text-label text-muted-foreground">{group.findings.length} places</p>
          </div>
        </div>
        <PriorityCell f={first} />
        <Button variant="outline" size="md" className="self-start print:hidden" aria-expanded={expanded} aria-controls={id} onClick={() => { setOpen((o) => !o); }}>
          {open ? "Hide places" : `Show ${String(group.findings.length)} places`} <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
        </Button>
      </div>
      <ul id={id} className={cn("border-t bg-background/40", !expanded && "hidden")}>
        {group.findings.map((f) => (
          <IssueRow key={f.id} finding={f} printing={printing} startHere={false} isNew={newIds?.has(f.id) ?? false} compact />
        ))}
      </ul>
    </li>
  );
}

function IssueRow({ finding: f, printing, startHere, isNew, compact = false }: { finding: Finding; printing: boolean; startHere: boolean; isNew: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const detailId = `finding-${f.id}`;
  const expanded = open || printing;
  return (
    <li className={cn("border-b last:border-b-0 print:break-inside-avoid", compact && "pl-3 sm:pl-6")}>
      <div className={cn("flex flex-col gap-3 px-3 sm:flex-row sm:items-start sm:gap-4", compact ? "py-3" : "py-4")}>
        <div className="grid min-w-0 flex-1 gap-2">
          {compact ? (
            <p className="flex flex-wrap items-center gap-2 font-mono text-label break-all text-muted-foreground">{f.subject}{isNew && <Badge variant="critical">New</Badge>}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-label font-light break-all text-muted-foreground">{f.subject}</span>
              </div>
              <Labels f={f} startHere={startHere} isNew={isNew} />
              <div className="grid gap-0.5">
                <p className="text-body font-medium break-words">{findingTitle(f)}</p>
                <p className="text-label font-light text-muted-foreground">{oneLiner(f)}</p>
              </div>
            </>
          )}
        </div>
        {!compact && <PriorityCell f={f} />}
        <Button variant="outline" size="md" className="self-start print:hidden" aria-expanded={expanded} aria-controls={detailId} onClick={() => { setOpen((o) => !o); }}>
          {open ? "Hide" : "How to fix"}
        </Button>
      </div>
      <div id={detailId} className={cn("px-3 pb-4", !expanded && "hidden")}>
        <FindingDetail f={f} />
      </div>
    </li>
  );
}

function FindingDetail({ f }: { f: Finding }) {
  const e = f.evidence;
  return (
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
      <FixGuidance finding={f} />
      <p className="text-label text-muted-foreground">
        Why this priority: <span className="font-mono">{f.rationale.join(" → ")}</span> · source {f.source.name}
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
  );
}

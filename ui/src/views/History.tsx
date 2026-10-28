import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@gateseeker/ui-kit";
import { formatDate } from "@/lib/utils";
import { ECOSYSTEM_LABELS, SEVERITY_LABELS, TYPE_LABELS, type UiRecord } from "@/types";
import { severityVariant } from "./PendingList";

export function History({ records, kind }: { records: UiRecord[]; kind: "approved" | "rejected" }) {
  if (records.length === 0) {
    return <p className="rounded-lg border border-dashed border-border-strong bg-card/50 p-6 text-sm text-muted-foreground">{kind === "approved" ? "Nenhum registro aprovado ainda." : "Nenhum registro rejeitado ainda."}</p>;
  }
  return (
    <div className="grid gap-3">
      {records.map((r) => (
        <Card key={r.id} data-testid={`${kind}-${r.id}`}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{r.id}</Badge>
              {kind === "approved" ? <Badge variant={severityVariant(r.data.severity)}>{SEVERITY_LABELS[r.data.severity].label}</Badge> : <Badge variant="secondary">rejeitado</Badge>}
              <Badge variant="secondary">{ECOSYSTEM_LABELS[r.data.ecosystem]}</Badge>
              <Badge variant="outline">{TYPE_LABELS[r.data.type]}</Badge>
            </div>
            <CardTitle>{r.data.summary}</CardTitle>
            <CardDescription>
              Revisado por {r.data.review.reviewed_by ?? "—"} em {formatDate(r.data.review.reviewed_at)} · pacotes: {r.data.packages.map((p) => p.name).join(", ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {kind === "approved" && <p><span className="font-medium">O que fazer:</span> {r.data.remediation}</p>}
            {r.data.review.notes && <p className="text-muted-foreground"><span className="font-medium text-foreground">Notas:</span> {r.data.review.notes}</p>}
            {(r.data.upstream.osv || r.data.upstream.ghsa) && (
              <p className="text-muted-foreground">
                Cobertura oficial: {[r.data.upstream.osv, r.data.upstream.ghsa].filter(Boolean).join(", ")}
              </p>
            )}
            <ul className="list-disc pl-5 text-muted-foreground">
              {r.data.sources.map((s) => (
                <li key={s.url}>
                  <a className="text-foreground underline decoration-border-strong hover:decoration-primary" href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.publisher}: {s.title}
                  </a>{" "}
                  ({s.published_at}){s.primary ? " · fonte primária" : ""}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

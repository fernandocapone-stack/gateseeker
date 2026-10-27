import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { ECOSYSTEM_LABELS, SEVERITY_LABELS, type UiRecord } from "@/types";

export function severityVariant(s: UiRecord["data"]["severity"]): "critical" | "high" | "moderate" | "low" {
  return s === "CRITICAL" ? "critical" : s === "HIGH" ? "high" : s === "MODERATE" ? "moderate" : "low";
}

export function PendingList({ records, onOpen }: { records: UiRecord[]; onOpen: (r: UiRecord) => void }) {
  if (records.length === 0) {
    return <p className="rounded-md border p-6 text-sm text-muted-foreground">Nenhuma proposta pendente. O coletor roda a cada 6 horas; novas propostas chegam por pull request e aparecem aqui.</p>;
  }
  return (
    <div className="grid gap-3">
      {records.map((r) => {
        const src = r.data.sources[0];
        const hasDraft = r.data.draft !== undefined && Object.keys(r.data.draft).length > 0;
        return (
          <Card key={r.id} data-testid={`pending-${r.id}`}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{r.id}</Badge>
                <Badge variant={severityVariant(r.data.severity)}>{SEVERITY_LABELS[r.data.severity].label} (proposta)</Badge>
                <Badge variant="secondary">{ECOSYSTEM_LABELS[r.data.ecosystem]}</Badge>
                {hasDraft && <Badge variant="moderate">rascunho pré-preenchido</Badge>}
              </div>
              <CardTitle>{src?.title ?? r.data.summary}</CardTitle>
              <CardDescription>
                {src?.publisher ?? "—"} · {formatDate(src?.published_at)} · pacotes: {r.data.packages.map((p) => p.name).join(", ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={() => onOpen(r)}>Revisar</Button>
              {src && (
                <Button variant="outline" onClick={() => window.open(src.url, "_blank", "noopener,noreferrer")}>
                  Abrir fonte <ExternalLink />
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

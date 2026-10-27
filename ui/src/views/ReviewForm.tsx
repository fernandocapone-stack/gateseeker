import { ArrowLeft, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { isoToLocalInput, localInputToIso } from "@/lib/utils";
import {
  ECOSYSTEM_LABELS,
  SEVERITY_LABELS,
  TYPE_LABELS,
  type Advisory,
  type AdvisoryPackage,
  type AdvisorySource,
  type Ecosystem,
  type Severity,
  type UiRecord,
} from "@/types";

const SUMMARY_MAX = 300;
const REMEDIATION_MAX = 500;

function emptyPackage(): AdvisoryPackage {
  return { name: "", affected: {} };
}
function emptySource(): AdvisorySource {
  return { url: "", publisher: "", title: "", published_at: new Date().toISOString().slice(0, 10) };
}

function list(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function ReviewForm({ record, onBack, onDecided }: { record: UiRecord; onBack: () => void; onDecided: (message: string) => Promise<void> }) {
  const [form, setForm] = useState<Advisory>(() => structuredClone(record.data));
  const [reason, setReason] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const draft = record.data.draft;
  const draftKeys = useMemo(() => new Set(Object.keys(draft ?? {})), [draft]);

  const distinctPublishers = new Set(form.sources.map((s) => s.publisher.trim().toLowerCase()).filter(Boolean)).size;
  const hasPrimary = form.sources.some((s) => s.primary);
  const canApprove = distinctPublishers >= 2 || hasPrimary;

  function set<K extends keyof Advisory>(key: K, value: Advisory[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setPackage(i: number, patch: Partial<AdvisoryPackage> | { affected: AdvisoryPackage["affected"] }) {
    setForm((f) => ({ ...f, packages: f.packages.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) }));
  }
  function setSource(i: number, patch: Partial<AdvisorySource>) {
    setForm((f) => ({ ...f, sources: f.sources.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  }
  function applyDraft() {
    if (!draft) return;
    const { draft: _ignored, ...fields } = draft as Advisory;
    setForm((f) => ({ ...f, ...fields }));
  }

  async function act(action: "approve" | "reject" | "save") {
    setBusy(true);
    setIssues([]);
    try {
      const payload: Advisory = { ...form };
      delete payload.draft;
      const r = await api.decide(record.id, action, payload, reason);
      if (r.ok) {
        await onDecided(
          action === "approve"
            ? `${record.id} aprovado e registrado${r.commit ? ` (commit ${r.commit})` : ""}. Use "Enviar para o GitHub" quando terminar o lote.`
            : action === "reject"
              ? `${record.id} rejeitado e registrado${r.commit ? ` (commit ${r.commit})` : ""}.`
              : `${record.id} salvo como rascunho.`,
        );
      } else {
        setIssues(r.issues);
      }
    } catch (err) {
      setIssues([err instanceof Error ? err.message : String(err)]);
    } finally {
      setBusy(false);
    }
  }

  const primarySource = form.sources[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft /> Voltar
          </Button>
          <Badge variant="outline">{record.id}</Badge>
          <span className="text-sm text-muted-foreground">proposto por {record.data.review.proposed_by}</span>
        </div>

        {draft && draftKeys.size > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning bg-warning/15 p-3 text-sm">
            <span>A engenharia pré-preencheu um rascunho para {draftKeys.size} campo(s). Nada vale até você confirmar.</span>
            <Button size="sm" variant="outline" onClick={applyDraft}>
              Usar rascunho
            </Button>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>O incidente</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="O que aconteceu" help="Escolha o tipo que melhor descreve o incidente." htmlFor="type" draft={draftKeys.has("type")}>
              <Select id="type" value={form.type} onChange={(e) => set("type", e.target.value as Advisory["type"])}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Gravidade" help={SEVERITY_LABELS[form.severity].help} htmlFor="severity" draft={draftKeys.has("severity")}>
              <Select id="severity" value={form.severity} onChange={(e) => set("severity", e.target.value as Severity)}>
                {Object.entries(SEVERITY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ecossistema" help="Onde o pacote é publicado. Para binários e releases, use Outro." htmlFor="ecosystem" draft={draftKeys.has("ecosystem")}>
              <Select id="ecosystem" value={form.ecosystem} onChange={(e) => set("ecosystem", e.target.value as Ecosystem)}>
                {Object.entries(ECOSYSTEM_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Janela do incidente (UTC)" help="Quando começou e quando terminou. Deixe o fim vazio se ainda estiver em aberto." draft={draftKeys.has("window")}>
              <div className="grid grid-cols-2 gap-2">
                <Input type="datetime-local" aria-label="início" value={isoToLocalInput(form.window.start)} onChange={(e) => set("window", { ...form.window, start: localInputToIso(e.target.value) })} />
                <Input type="datetime-local" aria-label="fim" value={isoToLocalInput(form.window.end)} onChange={(e) => set("window", { ...form.window, end: localInputToIso(e.target.value) })} />
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pacotes afetados</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {form.packages.map((p, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Input aria-label={`nome do pacote ${i + 1}`} placeholder="nome exato do pacote (ex.: laravel-lang/lang)" value={p.name} onChange={(e) => setPackage(i, { name: e.target.value })} />
                  <Button variant="ghost" size="icon" aria-label="remover pacote" onClick={() => set("packages", form.packages.filter((_, idx) => idx !== i))}>
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label="Versões afetadas" help="Separe por vírgula. Ex.: 1.2.3, 1.2.4">
                    <Input value={(p.affected.versions ?? []).join(", ")} onChange={(e) => setPackage(i, { affected: { ...p.affected, versions: list(e.target.value) } })} />
                  </Field>
                  <Field label="Corrigido a partir de" help="Primeira versão segura, se houver.">
                    <Input value={p.affected.fixed_in ?? ""} onChange={(e) => setPackage(i, { affected: { ...p.affected, fixed_in: e.target.value || null } })} />
                  </Field>
                  <Field label="Intervalo: de (inclusive)" help="Para faixas contínuas de versões.">
                    <Input value={p.affected.ranges?.[0]?.introduced ?? ""} onChange={(e) => setPackage(i, { affected: { ...p.affected, ranges: e.target.value ? [{ introduced: e.target.value, ...(p.affected.ranges?.[0]?.fixed ? { fixed: p.affected.ranges[0].fixed } : {}) }] : [] } })} />
                  </Field>
                  <Field label="Intervalo: até (exclusive)" help="Primeira versão fora da faixa afetada.">
                    <Input
                      value={p.affected.ranges?.[0]?.fixed ?? ""}
                      onChange={(e) =>
                        setPackage(i, {
                          affected: {
                            ...p.affected,
                            ranges: p.affected.ranges?.[0] ? [{ introduced: p.affected.ranges[0].introduced, ...(e.target.value ? { fixed: e.target.value } : {}) }] : p.affected.ranges,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Tags afetadas (Composer)" help="Use * para todas as tags existentes na janela.">
                    <Input value={(p.affected.tags ?? []).join(", ")} onChange={(e) => setPackage(i, { affected: { ...p.affected, tags: list(e.target.value) } })} />
                  </Field>
                  <Field label="Commits depois de (UTC)" help="Commits após este instante são suspeitos.">
                    <Input type="datetime-local" value={isoToLocalInput(p.affected.commits_after ?? null)} onChange={(e) => setPackage(i, { affected: { ...p.affected, ...(localInputToIso(e.target.value) ? { commits_after: localInputToIso(e.target.value) ?? undefined } : { commits_after: undefined }) } })} />
                  </Field>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => set("packages", [...form.packages, emptyPackage()])}>
              <Plus /> Adicionar pacote
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Em suas palavras</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Resumo em uma linha" help={`Escreva você mesmo, não copie da fonte. ${form.summary.length}/${SUMMARY_MAX}`} htmlFor="summary" draft={draftKeys.has("summary")}>
              <Textarea id="summary" maxLength={SUMMARY_MAX} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
            </Field>
            <Field label="O que quem instalou deve fazer" help={`Ação concreta. ${form.remediation.length}/${REMEDIATION_MAX}`} htmlFor="remediation" draft={draftKeys.has("remediation")}>
              <Textarea id="remediation" maxLength={REMEDIATION_MAX} value={form.remediation} onChange={(e) => set("remediation", e.target.value)} />
            </Field>
            <Field label="Indicadores (opcional)" help="Fatos verificáveis, um por linha. Nunca código do atacante." htmlFor="indicators" draft={draftKeys.has("indicators")}>
              <Textarea id="indicators" value={form.indicators.join("\n")} onChange={(e) => set("indicators", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Fontes{" "}
              <Badge variant={canApprove ? "success" : "moderate"}>{canApprove ? "suficientes para aprovar" : "precisa de 2 editores ou 1 fonte primária"}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {form.sources.map((s, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
                <Input aria-label={`editor da fonte ${i + 1}`} placeholder="editor (ex.: StepSecurity)" value={s.publisher} onChange={(e) => setSource(i, { publisher: e.target.value })} />
                <Input aria-label={`data da fonte ${i + 1}`} type="date" value={s.published_at} onChange={(e) => setSource(i, { published_at: e.target.value })} />
                <Input className="md:col-span-2" aria-label={`título da fonte ${i + 1}`} placeholder="título" value={s.title} onChange={(e) => setSource(i, { title: e.target.value })} />
                <Input className="md:col-span-2" aria-label={`link da fonte ${i + 1}`} placeholder="https://…" value={s.url} onChange={(e) => setSource(i, { url: e.target.value })} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" aria-label={`fonte primária ${i + 1}`} checked={s.primary === true} onChange={(e) => setSource(i, { primary: e.target.checked || undefined })} />
                  fonte primária (repositório ou registro do próprio pacote)
                </label>
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => set("sources", form.sources.filter((_, idx) => idx !== i))}>
                    <Trash2 /> remover
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => set("sources", [...form.sources, emptySource()])}>
              <Plus /> Adicionar fonte
            </Button>
          </CardContent>
        </Card>

        {issues.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
            <p className="font-medium">Não foi possível registrar:</p>
            <ul className="list-disc pl-5">
              {issues.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
        )}

        <Card>
          <CardContent className="grid gap-3 pt-5">
            <Field label="Motivo da rejeição" help="Obrigatório só para rejeitar. Fica registrado para que a proposta não volte." htmlFor="reason">
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex.: já coberto pelo OSV (MAL-2026-…), ou: não é pacote, é vulnerabilidade" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="success" disabled={busy || !canApprove} onClick={() => void act("approve")} data-testid="approve">
                Aprovar
              </Button>
              <Button variant="destructive" disabled={busy || reason.trim().length === 0} onClick={() => void act("reject")} data-testid="reject">
                Rejeitar
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void act("save")} data-testid="save">
                Deixar para depois
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-2 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Fonte original</h2>
          {primarySource && (
            <a className="inline-flex items-center gap-1 text-sm underline" href={primarySource.url} target="_blank" rel="noopener noreferrer">
              abrir em nova aba <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
        {primarySource ? (
          <iframe title="fonte original" src={primarySource.url} className="h-[80vh] w-full rounded-md border bg-white" sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />
        ) : (
          <p className="text-sm text-muted-foreground">Sem fonte.</p>
        )}
        <p className="text-xs text-muted-foreground">Alguns sites não permitem exibição embutida; nesse caso use "abrir em nova aba".</p>
      </div>
    </div>
  );
}

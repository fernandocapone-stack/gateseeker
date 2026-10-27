import { useCallback, useEffect, useState } from "react";
import { api, sessionToken } from "./api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import type { UiRecord, UiState } from "./types";
import { History } from "./views/History";
import { PendingList } from "./views/PendingList";
import { ReviewForm } from "./views/ReviewForm";

type Tab = "pending" | "approved" | "rejected";

export function App() {
  const [state, setState] = useState<UiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const [selected, setSelected] = useState<UiRecord | null>(null);
  const [pushing, setPushing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!sessionToken()) {
      setError("Esta página precisa do endereço completo impresso pelo comando `gateseeker-intel ui`, que inclui o token da sessão.");
      return;
    }
    void refresh();
  }, [refresh]);

  async function onPush() {
    setPushing(true);
    try {
      const r = await api.push();
      setNotice(r.ok ? "Enviado para o GitHub." : `Falha ao enviar: ${r.error}`);
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-0.5 inline-block size-7 shrink-0 rounded-sm border border-primary bg-primary shadow-solid-sm" />
          <div>
          <h1 className="text-xl font-semibold tracking-tight">Gateseeker · Triagem de advisories</h1>
          <p className="text-sm text-muted-foreground">
            Revisor: <strong>{state?.gitUser ?? "—"}</strong>
            {state?.branch && <> · branch <code className="rounded bg-muted px-1">{state.branch}</code></>}
            {state?.mergedIntelBranch && <> · lote <code className="rounded bg-muted px-1">{state.mergedIntelBranch.replace("origin/", "")}</code> incorporado</>}
          </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state && state.unpushed > 0 && <Badge variant="moderate">{state.unpushed} decisão(ões) ainda não enviada(s)</Badge>}
          <Button variant="outline" onClick={() => void onPush()} disabled={pushing || !state || state.unpushed === 0}>
            {pushing ? "Enviando…" : "Enviar para o GitHub"}
          </Button>
        </div>
      </header>

      {error && <div className="mb-4 rounded-md border border-destructive/60 bg-destructive/15 p-3 text-sm">{error}</div>}
      {notice && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-primary/50 bg-primary/10 p-3 text-sm">
          <span>{notice}</span>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            fechar
          </Button>
        </div>
      )}
      {state && state.warnings.length > 0 && (
        <details className="mb-4 rounded-md border bg-card p-3 text-sm">
          <summary className="cursor-pointer">{state.warnings.length} aviso(s) do repositório</summary>
          <ul className="mt-2 list-disc pl-5 text-muted-foreground">
            {state.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {selected ? (
        <ReviewForm
          record={selected}
          onBack={() => setSelected(null)}
          onDecided={async (message) => {
            setNotice(message);
            setSelected(null);
            await refresh();
          }}
        />
      ) : (
        <>
          <nav className="mb-4 flex gap-1 border-b" aria-label="Seções">
            {(
              [
                ["pending", `Pendentes (${state?.pending.length ?? 0})`],
                ["approved", `Aprovados (${state?.approved.length ?? 0})`],
                ["rejected", `Rejeitados (${state?.rejected.length ?? 0})`],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground"}`}
                aria-current={tab === key ? "page" : undefined}
              >
                {label}
              </button>
            ))}
          </nav>
          {!state && !error && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {state && tab === "pending" && <PendingList records={state.pending} onOpen={setSelected} />}
          {state && tab === "approved" && <History records={state.approved} kind="approved" />}
          {state && tab === "rejected" && <History records={state.rejected} kind="rejected" />}
        </>
      )}
    </div>
  );
}

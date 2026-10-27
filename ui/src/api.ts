import type { Advisory, DecideAction, DecideResponse, PushResponse, UiState } from "./types";

const TOKEN_KEY = "gateseeker.token";

/** Reads the session token from the URL once, keeps it in sessionStorage, and removes it from the address bar. */
export function sessionToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      /* private mode: keep in memory below */
    }
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
    memoryToken = fromUrl;
    return fromUrl;
  }
  if (memoryToken) return memoryToken;
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
let memoryToken: string | null = null;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionToken();
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-gateseeker-token": token ?? "", ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as T & { error?: string };
  if (res.status === 401) throw new Error("Sessão inválida. Feche esta aba e abra o endereço impresso pelo comando `gateseeker-intel ui`.");
  if (res.status >= 500) throw new Error(body.error ?? `Erro ${res.status}`);
  return body;
}

export const api = {
  state: () => call<UiState>("/api/state"),
  decide: (id: string, action: DecideAction, record: Advisory, reason?: string) =>
    call<DecideResponse>("/api/decide", { method: "POST", body: JSON.stringify({ id, action, record, reason }) }),
  push: () => call<PushResponse>("/api/push", { method: "POST", body: "{}" }),
};

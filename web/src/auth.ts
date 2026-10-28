import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Sign-in for the demo workspace. The page asks the service how users sign in
 * (GET /api/config) and builds one of three clients:
 *   supabase  production: Supabase Auth with the GitHub provider (PKCE flow)
 *   stub      local server and browser tests: a fixed token, no network
 *   none      the service has no auth configured; the workspace stays closed
 *
 * The access token is sent to our own /api routes as a bearer header and
 * nowhere else. Nothing here reads or writes Supabase tables.
 */

export interface SessionUser {
  id: string;
  login: string | null;
  avatarUrl: string | null;
}

export interface Session {
  accessToken: string;
  user: SessionUser;
}

export type AuthMode = "supabase" | "stub" | "none";

export interface AuthClient {
  mode: AuthMode;
  getSession(): Promise<Session | null>;
  /** Starts sign-in; may navigate away (OAuth). `next` is the in-app path to return to. */
  signIn(next: string): Promise<void>;
  signOut(): Promise<void>;
  onChange(cb: (s: Session | null) => void): () => void;
}

type Config = { mode: "supabase"; url: string; anonKey: string } | { mode: "stub"; token: string } | { mode: "none" };

export async function loadAuth(): Promise<AuthClient> {
  let config: Config = { mode: "none" };
  try {
    const res = await fetch("/api/config");
    const body = (await res.json()) as { ok?: boolean; auth?: Config };
    if (body.ok && body.auth && (body.auth.mode === "supabase" || body.auth.mode === "stub" || body.auth.mode === "none")) config = body.auth;
  } catch {
    config = { mode: "none" };
  }
  if (config.mode === "supabase") return supabaseAuth(config.url, config.anonKey);
  if (config.mode === "stub") return stubAuth(config.token);
  return noneAuth();
}

const NEXT_KEY = "gateseeker:next";

/** Remembers where to go after an OAuth round trip; only in-app paths are accepted. */
export function rememberNext(next: string): void {
  try {
    sessionStorage.setItem(NEXT_KEY, safeNext(next));
  } catch {
    /* storage unavailable: land on /app */
  }
}

export function takeNext(): string {
  try {
    const v = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return safeNext(v ?? "/app");
  } catch {
    return "/app";
  }
}

export function safeNext(next: string): string {
  return /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(next) ? next : "/app";
}

function supabaseAuth(url: string, anonKey: string): AuthClient {
  const client: SupabaseClient = createClient(url, anonKey, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const toSession = (s: { access_token: string; user: { id: string; user_metadata?: Record<string, unknown> } } | null): Session | null => {
    if (!s) return null;
    const meta = s.user.user_metadata ?? {};
    const login = typeof meta.user_name === "string" ? meta.user_name : typeof meta.preferred_username === "string" ? meta.preferred_username : null;
    const avatar = typeof meta.avatar_url === "string" && meta.avatar_url.startsWith("https://avatars.githubusercontent.com/") ? meta.avatar_url : null;
    return { accessToken: s.access_token, user: { id: s.user.id, login: login !== null && /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : null, avatarUrl: avatar } };
  };
  return {
    mode: "supabase",
    async getSession() {
      const { data } = await client.auth.getSession();
      return toSession(data.session);
    },
    async signIn(next) {
      rememberNext(next);
      await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}/login` } });
    },
    async signOut() {
      await client.auth.signOut();
    },
    onChange(cb) {
      const { data } = client.auth.onAuthStateChange((_event, s) => { cb(toSession(s)); });
      return () => { data.subscription.unsubscribe(); };
    },
  };
}

const STUB_KEY = "gateseeker:stub-session";

function stubAuth(token: string): AuthClient {
  const listeners = new Set<(s: Session | null) => void>();
  const read = (): Session | null => {
    try {
      return localStorage.getItem(STUB_KEY) === "1" ? { accessToken: token, user: { id: "stub", login: "e2e-user", avatarUrl: null } } : null;
    } catch {
      return null;
    }
  };
  const emit = () => { const s = read(); for (const l of listeners) l(s); };
  return {
    mode: "stub",
    getSession: () => Promise.resolve(read()),
    signIn(next) {
      localStorage.setItem(STUB_KEY, "1");
      rememberNext(next);
      emit();
      return Promise.resolve();
    },
    signOut() {
      localStorage.removeItem(STUB_KEY);
      emit();
      return Promise.resolve();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

function noneAuth(): AuthClient {
  return {
    mode: "none",
    getSession: () => Promise.resolve(null),
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    onChange: () => () => undefined,
  };
}

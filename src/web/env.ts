import { createStaticAuth, createSupabaseAuth } from "./auth.js";
import { DEFAULT_QUOTA, type HandlerOptions } from "./handler.js";
import { createMemoryStore, createSupabaseStore } from "./store.js";

/**
 * Builds the handler options from environment variables, the one place the
 * Vercel functions and the local server read configuration. Nothing here is
 * logged; keys stay inside the returned closures.
 *
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *                              production: Supabase Auth + Postgres store
 *   GATESEEKER_AUTH_STUB=1     local/e2e: fixed token "e2e-token", memory store (ignored when SUPABASE_URL is set)
 *   GATESEEKER_SCAN_LIMIT      analyses per user per hour (default 10)
 *   GITHUB_TOKEN               optional read-only token for the GitHub API limit
 *   GATESEEKER_GITHUB_API, GATESEEKER_GITHUB_ARCHIVE, GATESEEKER_OSV_ENDPOINT, GATESEEKER_PACKAGIST_BASE
 *                              upstream overrides (tests point them at stubs)
 */

export type Env = Record<string, string | undefined>;

/** What the page needs to sign users in; the anon key is public by design. */
export type AuthConfig = { mode: "supabase"; url: string; anonKey: string } | { mode: "stub"; token: string } | { mode: "none" };

export const STUB_TOKEN = "e2e-token";
export const STUB_USER = { id: "00000000-0000-4000-8000-00000000e2e0", login: "e2e-user" };

export function authConfigFromEnv(env: Env): AuthConfig {
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) return { mode: "supabase", url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY };
  if (env.GATESEEKER_AUTH_STUB === "1") return { mode: "stub", token: STUB_TOKEN };
  return { mode: "none" };
}

export interface EnvHandlerOptions {
  env: Env;
  workDir?: string;
  fetch?: typeof fetch;
}

export function handlerOptionsFromEnv({ env, workDir, fetch: fetchFn }: EnvHandlerOptions): HandlerOptions {
  const limit = Number(env.GATESEEKER_SCAN_LIMIT ?? "");
  const quota = Number.isInteger(limit) && limit > 0 ? { limit, windowSeconds: DEFAULT_QUOTA.windowSeconds } : DEFAULT_QUOTA;
  const scan: HandlerOptions["scan"] = {
    ...(env.GATESEEKER_OSV_ENDPOINT ? { osv: { endpoint: env.GATESEEKER_OSV_ENDPOINT } } : {}),
    ...(env.GATESEEKER_PACKAGIST_BASE ? { packagist: { base: env.GATESEEKER_PACKAGIST_BASE } } : {}),
  };
  const base: HandlerOptions = {
    quota,
    scan,
    ...(workDir ? { workDir } : {}),
    ...(fetchFn ? { fetch: fetchFn } : {}),
    ...(env.GATESEEKER_GITHUB_API ? { apiBase: env.GATESEEKER_GITHUB_API } : {}),
    ...(env.GATESEEKER_GITHUB_ARCHIVE ? { archiveBase: env.GATESEEKER_GITHUB_ARCHIVE } : {}),
    ...(env.GITHUB_TOKEN ? { githubToken: env.GITHUB_TOKEN } : {}),
  };
  const auth = authConfigFromEnv(env);
  if (auth.mode === "supabase") {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required when SUPABASE_URL is set.");
    return {
      ...base,
      auth: createSupabaseAuth({ url: auth.url, anonKey: auth.anonKey, ...(fetchFn ? { fetch: fetchFn } : {}) }),
      store: createSupabaseStore({ url: auth.url, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, ...(fetchFn ? { fetch: fetchFn } : {}) }),
    };
  }
  if (auth.mode === "stub") {
    return { ...base, auth: createStaticAuth({ [STUB_TOKEN]: STUB_USER }), store: createMemoryStore() };
  }
  return base;
}

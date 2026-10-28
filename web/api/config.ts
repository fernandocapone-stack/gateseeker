import { authConfigFromEnv } from "gateseeker/dist/web/env.js";

/** GET /api/config: how the page signs users in. The Supabase URL and anon key are public by design. */
export function GET(): Response {
  return Response.json({ ok: true, auth: authConfigFromEnv(process.env) }, { headers: { "cache-control": "no-store" } });
}

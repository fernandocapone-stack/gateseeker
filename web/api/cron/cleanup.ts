import { handlerOptionsFromEnv } from "gateseeker/dist/web/env.js";
import { handleCleanupRequest } from "gateseeker/dist/web/handler.js";

/**
 * GET /api/cron/cleanup: deletes expired reports. Vercel Cron calls it daily
 * with `Authorization: Bearer <CRON_SECRET>`; the daily write also keeps the
 * free Supabase project from pausing for inactivity.
 */
const options = handlerOptionsFromEnv({ env: process.env, workDir: "/tmp", requireAuth: true });

export async function GET(req: Request): Promise<Response> {
  const out = await handleCleanupRequest(options, req.headers.get("authorization"), process.env.CRON_SECRET);
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

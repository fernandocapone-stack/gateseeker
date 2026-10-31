import { handlerOptionsFromEnv } from "gateseeker/dist/web/env.js";
import { handleMonitorRequest } from "gateseeker/dist/web/handler.js";

/**
 * GET /api/cron/monitor: the daily rescan of followed repositories
 * (docs/SPRINT_6.md 3.4). Vercel Cron calls it with
 * `Authorization: Bearer <CRON_SECRET>`; on the Hobby plan, once a day at an
 * approximate time. Each call works within its time budget and leaves the
 * rest of the queue for the next one.
 */
export const config = { maxDuration: 300 };

const options = handlerOptionsFromEnv({ env: process.env, workDir: "/tmp", requireAuth: true });

export async function GET(req: Request): Promise<Response> {
  const out = await handleMonitorRequest({ ...options, budgetMs: 270_000 }, req.headers.get("authorization"), process.env.CRON_SECRET);
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

import { handlerOptionsFromEnv } from "gateseeker/dist/web/env.js";
import { handleFeedPublishedRequest } from "gateseeker/dist/web/handler.js";

/**
 * POST /api/feed/published: the feed workflow sends the approved advisory
 * set, signed with GATESEEKER_FEED_KEY, after approved records reach main
 * (docs/SPRINT_6.md 3.5). The signature is the authentication. The service
 * stores the set, queues the followed repositories of the ecosystems that
 * changed and rescans them right away within the time budget.
 */
export const config = { maxDuration: 300 };

const options = handlerOptionsFromEnv({ env: process.env, workDir: "/tmp", requireAuth: true });

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* answered as bad-request below */
  }
  const out = await handleFeedPublishedRequest(body, { ...options, budgetMs: 270_000 });
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

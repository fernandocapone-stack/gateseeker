import { handlerOptionsFromEnv } from "gateseeker/dist/web/env.js";
import { handleUnsubscribeRequest } from "gateseeker/dist/web/handler.js";

/**
 * POST /api/unsubscribe: stop following a repository from an email
 * (docs/SPRINT_6.md 3.6). The /unsubscribe page posts JSON {f, t}; the
 * one-click List-Unsubscribe header posts a form body with the id and token
 * in the query. No session: the signed token is the proof.
 */
const options = handlerOptionsFromEnv({ env: process.env, workDir: "/tmp", requireAuth: true });

export async function POST(req: Request): Promise<Response> {
  const query = new URL(req.url).searchParams;
  let input: unknown = { f: query.get("f"), t: query.get("t") };
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      input = await req.json();
    } catch {
      /* answered as an invalid link below */
    }
  }
  const out = await handleUnsubscribeRequest(input, options);
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

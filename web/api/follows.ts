import { handlerOptionsFromEnv } from "gateseeker/dist/web/env.js";
import { handleFollowsRequest } from "gateseeker/dist/web/handler.js";

/** /api/follows: GET lists the followed repositories; POST and DELETE take {owner, repo}. */
const options = handlerOptionsFromEnv({ env: process.env, workDir: "/tmp", requireAuth: true });

async function handle(req: Request): Promise<Response> {
  let body: unknown = null;
  if (req.method !== "GET") {
    try {
      const text = await req.text();
      if (text.length > 1024) return Response.json({ ok: false, error: { code: "bad-request", message: "Body too large." } }, { status: 413 });
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  const out = await handleFollowsRequest(req.method, body, options, req.headers.get("authorization"));
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;

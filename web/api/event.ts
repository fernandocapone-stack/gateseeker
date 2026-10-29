import { handlerOptionsFromEnv } from "gateseeker/dist/web/env.js";
import { handleEventRequest } from "gateseeker/dist/web/handler.js";

/**
 * POST /api/event: adds one to an aggregate login-funnel counter (kind and
 * UTC day only; no user, IP or user agent). Anonymous on purpose: the visit
 * to /login happens before sign-in.
 */
const options = handlerOptionsFromEnv({ env: process.env, workDir: "/tmp", requireAuth: true });

export function GET(): Response {
  return Response.json({ ok: false, error: { code: "bad-request", message: "POST only." } }, { status: 405, headers: { allow: "POST" } });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    const text = await req.text();
    if (text.length > 256) return Response.json({ ok: false, error: { code: "bad-request", message: "Body too large." } }, { status: 413 });
    body = JSON.parse(text) as unknown;
  } catch {
    body = null;
  }
  const out = await handleEventRequest(body, options);
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

import { handlerOptionsFromEnv } from "gateseeker/dist/web/env.js";
import { handleScanRequest } from "gateseeker/dist/web/handler.js";

/**
 * Vercel Function (Node.js runtime) for POST /api/scan. Thin: parse the
 * body, call the shared handler with options built from the environment
 * (Supabase Auth + store in production), answer JSON.
 */
export const config = { maxDuration: 150 };

const options = handlerOptionsFromEnv({ env: process.env, workDir: "/tmp", requireAuth: true });

export function GET(): Response {
  return Response.json({ ok: false, error: { code: "bad-request", message: "POST only." } }, { status: 405, headers: { allow: "POST" } });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown = null;
  try {
    const text = await req.text();
    if (text.length > 4096) return Response.json({ ok: false, error: { code: "bad-request", message: "Body too large." } }, { status: 413 });
    body = JSON.parse(text) as unknown;
  } catch {
    body = null;
  }
  const out = await handleScanRequest(body, options, req.headers.get("authorization"));
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

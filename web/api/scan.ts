import { handleScanRequest } from "gateseeker/dist/web/handler.js";

/**
 * Vercel Function (Node.js runtime) for POST /api/scan. Thin: parse the
 * body, call the shared handler, answer JSON. Rate limiting and persistence
 * arrive with the Supabase step of Sprint 4.
 */
export const config = { maxDuration: 150 };

// Web-signature exports named after the HTTP method: the shape Vercel's Node.js
// runtime documents. A default export with a Request parameter was deployed as a
// (req, res) handler and never answered.
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
  const out = await handleScanRequest(body, { workDir: "/tmp" });
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

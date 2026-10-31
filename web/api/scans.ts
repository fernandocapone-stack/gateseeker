import { handlerOptionsFromEnv } from "gateseeker/dist/web/env.js";
import { handleScansRequest } from "gateseeker/dist/web/handler.js";

/** GET /api/scans: the signed-in account's analysis history, newest first. */
const options = handlerOptionsFromEnv({ env: process.env, workDir: "/tmp", requireAuth: true });

export async function GET(req: Request): Promise<Response> {
  const out = await handleScansRequest(options, req.headers.get("authorization"));
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

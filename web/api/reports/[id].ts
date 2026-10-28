import { handlerOptionsFromEnv } from "gateseeker/dist/web/env.js";
import { handleReportRequest } from "gateseeker/dist/web/handler.js";

/** GET /api/reports/<id>: a saved report, only for the account that produced it. */
const options = handlerOptionsFromEnv({ env: process.env, workDir: "/tmp" });

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).pathname.split("/").pop() ?? "";
  const out = await handleReportRequest(id, options, req.headers.get("authorization"));
  return Response.json(out.body, { status: out.status, headers: { "cache-control": "no-store" } });
}

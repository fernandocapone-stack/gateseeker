import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { handleScanRequest } from "./handler.js";

/**
 * Development and end-to-end server for the public page: serves web/dist and
 * answers POST /api/scan with the shared handler. It is not the production
 * deployment (that is the Vercel function in web/api) and has no rate
 * limiting or persistence. Started by `node dist/web/local-server.js`.
 *
 * Environment (all optional):
 *   GATESEEKER_WEB_PORT      default 4320
 *   GATESEEKER_WEB_DIST      default <repo>/web/dist
 *   GATESEEKER_GITHUB_API    default https://api.github.com   (tests point it at a stub)
 *   GATESEEKER_GITHUB_ARCHIVE default https://codeload.github.com
 *   GATESEEKER_OSV_ENDPOINT  default the OSV client's default
 */

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.env.GATESEEKER_WEB_DIST ?? join(here, "..", "..", "web", "dist"));
const port = Number(process.env.GATESEEKER_WEB_PORT ?? "4320");
const host = "127.0.0.1";
const MAX_BODY = 4096;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolveBody) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolveBody(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { resolveBody(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", () => { resolveBody(null); });
  });
}

function serveStatic(res: ServerResponse, urlPath: string): void {
  const safe = urlPath.split("/").filter((s) => s !== "" && s !== "." && s !== "..").join("/");
  let file = join(dist, safe);
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  // Single-page app: unknown paths fall back to index.html.
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" }).end("web/dist not built; run pnpm build:web");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  if (url.pathname === "/api/scan") {
    if (req.method !== "POST") {
      json(res, 405, { ok: false, error: { code: "bad-request", message: "POST only." } });
      return;
    }
    void (async () => {
      const raw = await readBody(req);
      let body: unknown;
      try {
        body = raw === null ? null : (JSON.parse(raw) as unknown);
      } catch {
        body = null;
      }
      const scan: Parameters<typeof handleScanRequest>[1]["scan"] = {
        ...(process.env.GATESEEKER_OSV_ENDPOINT ? { osv: { endpoint: process.env.GATESEEKER_OSV_ENDPOINT } } : {}),
        ...(process.env.GATESEEKER_PACKAGIST_BASE ? { packagist: { base: process.env.GATESEEKER_PACKAGIST_BASE } } : {}),
      };
      const out = await handleScanRequest(body, {
        ...(process.env.GATESEEKER_GITHUB_API ? { apiBase: process.env.GATESEEKER_GITHUB_API } : {}),
        ...(process.env.GATESEEKER_GITHUB_ARCHIVE ? { archiveBase: process.env.GATESEEKER_GITHUB_ARCHIVE } : {}),
        scan,
      });
      json(res, out.status, out.body);
    })();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  serveStatic(res, url.pathname);
});

server.listen(port, host, () => {
  console.log(`gateseeker web (local) listening on http://${host}:${port}/ serving ${dist}`);
});

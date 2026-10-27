import { SUMMARY_MARKER } from "../report/summary.js";

/**
 * Minimal GitHub REST client for the Action: create-or-update one sticky
 * comment on a pull request. Uses only fetch and the workflow's token.
 */

export interface GitHubApiOptions {
  apiUrl: string; // e.g. https://api.github.com
  token: string;
  repo: string; // owner/name
  fetch?: typeof fetch;
}

interface Comment {
  id: number;
  body: string;
}

async function request(opts: GitHubApiOptions, method: string, path: string, body?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const res = await fetchFn(`${opts.apiUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${opts.token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28", "user-agent": "gateseeker-action" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) return { ok: false, status: res.status, error: (await res.text()).slice(0, 200) };
  return { ok: true, data: (await res.json()) };
}

function isComment(x: unknown): x is Comment {
  return typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "number" && typeof (x as { body?: unknown }).body === "string";
}

/** Posts the summary as a single comment identified by SUMMARY_MARKER, updating it on later runs. */
export async function upsertStickyComment(opts: GitHubApiOptions, prNumber: number, markdown: string): Promise<{ ok: true; action: "created" | "updated"; id: number } | { ok: false; error: string }> {
  const list = await request(opts, "GET", `/repos/${opts.repo}/issues/${prNumber}/comments?per_page=100`);
  if (!list.ok) return { ok: false, error: `listing comments failed: HTTP ${list.status} ${list.error}` };
  const comments = Array.isArray(list.data) ? list.data.filter(isComment) : [];
  const existing = comments.find((c) => c.body.includes(SUMMARY_MARKER));
  if (existing) {
    const upd = await request(opts, "PATCH", `/repos/${opts.repo}/issues/comments/${existing.id}`, { body: markdown });
    return upd.ok && isComment(upd.data) ? { ok: true, action: "updated", id: upd.data.id } : { ok: false, error: `updating comment failed: ${upd.ok ? "unexpected response" : `HTTP ${upd.status} ${upd.error}`}` };
  }
  const created = await request(opts, "POST", `/repos/${opts.repo}/issues/${prNumber}/comments`, { body: markdown });
  return created.ok && isComment(created.data) ? { ok: true, action: "created", id: created.data.id } : { ok: false, error: `creating comment failed: ${created.ok ? "unexpected response" : `HTTP ${created.status} ${created.error}`}` };
}

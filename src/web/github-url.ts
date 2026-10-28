/**
 * Strict parser for the one input the hosted service accepts: the URL of a
 * public GitHub repository. Everything else is rejected before any network
 * request is made. The parser is a fixed grammar, not a general URL parser:
 * no userinfo, no query, no fragment, no ports, no IPs, no other hosts.
 */

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit from a /tree/<ref> suffix; null means the default branch. */
  ref: string | null;
}

export type GitHubUrlResult = { ok: true; value: GitHubRepoRef } | { ok: false; reason: string };

const MAX_INPUT = 300;
// GitHub user/org names: 1-39 chars, alphanumerics and hyphens, no leading/trailing hyphen.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
// Repository names: alphanumerics, dot, underscore, hyphen; never "." or ".."; ".git" suffix tolerated.
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
// Refs: branch/tag names or commit shas; conservative subset of git-check-ref-format.
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

export function parseGitHubRepoUrl(input: string): GitHubUrlResult {
  if (typeof input !== "string") return { ok: false, reason: "The repository URL must be text." };
  const raw = input.trim();
  if (raw.length === 0) return { ok: false, reason: "Paste the URL of a public GitHub repository." };
  if (raw.length > MAX_INPUT) return { ok: false, reason: "The URL is too long." };
  // Only printable ASCII: no control characters, no look-alike Unicode hosts.
  if (/[^\x21-\x7e]/.test(raw)) return { ok: false, reason: "The URL contains characters that are not allowed." };
  if (raw.includes("@")) return { ok: false, reason: "Credentials in the URL are not allowed." };
  if (raw.includes("?") || raw.includes("#")) return { ok: false, reason: "Query strings and fragments are not allowed." };

  let rest = raw;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(rest);
  if (scheme) {
    if (scheme[1]?.toLowerCase() !== "https") return { ok: false, reason: "Only https://github.com URLs are accepted." };
    rest = rest.slice(scheme[0].length);
  }
  const slash = rest.indexOf("/");
  const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return { ok: false, reason: "Only public repositories on github.com are supported." };
  if (slash === -1) return { ok: false, reason: "The URL must point to a repository: https://github.com/<owner>/<repo>." };

  const segments = rest
    .slice(slash + 1)
    .split("/")
    .filter((s, i, a) => !(s === "" && i === a.length - 1)); // tolerate one trailing slash
  if (segments.length < 2 || segments.some((s) => s === "")) return { ok: false, reason: "The URL must point to a repository: https://github.com/<owner>/<repo>." };

  const owner = segments[0] ?? "";
  let repo = segments[1] ?? "";
  if (!OWNER.test(owner)) return { ok: false, reason: "That is not a valid GitHub user or organization name." };
  if (repo.toLowerCase().endsWith(".git")) repo = repo.slice(0, -4);
  if (!REPO.test(repo) || repo === "." || repo === "..") return { ok: false, reason: "That is not a valid repository name." };

  let ref: string | null = null;
  if (segments.length > 2) {
    const [kind, ...refParts] = segments.slice(2);
    if (kind !== "tree" || refParts.length === 0) return { ok: false, reason: "Only the repository root or a /tree/<branch> URL is accepted." };
    const joined = refParts.join("/");
    if (!REF.test(joined) || joined.includes("..") || joined.endsWith(".lock") || joined.endsWith("/")) return { ok: false, reason: "That branch or tag name is not valid." };
    ref = joined;
  }
  return { ok: true, value: { owner, repo, ref } };
}

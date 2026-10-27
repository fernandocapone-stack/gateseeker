import { entropyBitsPerChar, looksLikePlaceholder, redactInLine } from "../redact.js";
import type { Rule, RuleMatch } from "../types.js";

/**
 * GSK-SECRET-001: a credential with a provider-specific, high-precision format
 * appears literally in a file. Only formats whose prefix makes them
 * unambiguous are included; generic "looks random" detection is out of scope
 * because its false-positive rate would hurt trust.
 *
 * Google `AIza...` keys are deliberately NOT included: Firebase web API keys use
 * that format and are public by design, so the pattern alone cannot tell a
 * secret from a public key.
 */

interface SecretPattern {
  name: string;
  regex: RegExp;
  /** Minimum Shannon entropy of the random part, to reject placeholders. */
  minEntropy: number;
  /** Extra validation on the matched token. */
  validate?: (token: string) => boolean;
}

export function decodeJwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[1] === undefined) return null;
  try {
    const payload = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const obj = JSON.parse(payload) as { role?: unknown };
    return typeof obj.role === "string" ? obj.role : null;
  } catch {
    return null;
  }
}

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: "aws-access-key-id", regex: /\bAKIA[0-9A-Z]{16}\b/g, minEntropy: 3.0 },
  { name: "stripe-live-secret-key", regex: /\b[sr]k_live_[0-9a-zA-Z]{16,}\b/g, minEntropy: 3.5 },
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g, minEntropy: 4.0 },
  { name: "github-fine-grained-pat", regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, minEntropy: 4.0 },
  { name: "anthropic-api-key", regex: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g, minEntropy: 4.0 },
  { name: "openai-project-key", regex: /\bsk-proj-[A-Za-z0-9_-]{32,}\b/g, minEntropy: 4.0 },
  { name: "openai-api-key", regex: /\bsk-[A-Za-z0-9]{40,}\b/g, minEntropy: 4.0 },
  { name: "slack-token", regex: /\bxox[bap]-[0-9A-Za-z-]{20,}\b/g, minEntropy: 3.5 },
  { name: "private-key-pem", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, minEntropy: 0 },
  {
    name: "supabase-service-role-jwt",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    minEntropy: 0,
    validate: (token) => decodeJwtRole(token) === "service_role",
  },
];

const EXAMPLE_ENV = /\.env(\.[\w.-]+)?\.(example|sample|template|dist)$/i;
const DOC_EXT = /\.(md|mdx|txt|rst)$/i;

function randomPart(token: string): string {
  // Strip the fixed prefix so entropy is measured on the variable part.
  return token.replace(/^(AKIA|[sr]k_live_|gh[pousr]_|github_pat_|sk-ant-|sk-proj-|sk-|xox[bap]-)/, "");
}

export const secretHardcodedRule: Rule = {
  id: "GSK-SECRET-001",
  title: "Credential with a known provider format is hardcoded",
  severity: "CRITICAL",
  description:
    "A token matching a provider-specific secret format (AWS, Stripe live, GitHub, OpenAI, Anthropic, Slack, PEM private key, Supabase service_role JWT) appears literally in the project.",
  action:
    "Revoke the credential at the provider, move it to a server-side environment variable or secret manager, and purge it from git history.",
  appliesTo: (file) => file.fileClass !== "test" && !EXAMPLE_ENV.test(file.path) && !DOC_EXT.test(file.path),
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      if (line.length > 5000) continue; // minified or data line; skip to keep regex time bounded
      const found: { name: string; token: string }[] = [];
      for (const p of SECRET_PATTERNS) {
        p.regex.lastIndex = 0;
        for (const m of line.matchAll(p.regex)) {
          const token = m[0];
          if (looksLikePlaceholder(token)) continue;
          if (p.minEntropy > 0 && entropyBitsPerChar(randomPart(token)) < p.minEntropy) continue;
          if (p.validate && !p.validate(token)) continue;
          // Avoid double-reporting a token caught by two overlapping patterns.
          if (found.some((f) => f.token.includes(token) || token.includes(f.token))) continue;
          found.push({ name: p.name, token });
        }
      }
      for (const f of found) {
        matches.push({
          line: i + 1,
          snippet: redactInLine(line, [f.token]),
          message: `Hardcoded credential of type "${f.name}" (${f.token.length} characters).`,
          details: { secretType: f.name, secretLength: f.token.length },
        });
      }
    }
    return matches;
  },
};

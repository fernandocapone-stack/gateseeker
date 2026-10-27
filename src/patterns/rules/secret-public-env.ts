import { sanitize } from "../../report/text.js";
import { maskQuotedLiterals, redactEnvLine } from "../redact.js";
import type { Rule, RuleMatch } from "../types.js";

/**
 * GSK-SECRET-002: an environment variable whose prefix makes the bundler
 * inline it into client code (NEXT_PUBLIC_, VITE_, ...) has a name that says
 * it is a secret. Whatever its value, that value ships to every browser.
 */

export const PUBLIC_PREFIXES = ["NEXT_PUBLIC_", "VITE_", "REACT_APP_", "EXPO_PUBLIC_", "NUXT_PUBLIC_", "GATSBY_", "PUBLIC_"];

const SECRET_WORDS = /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|PASSWD|CLIENT_SECRET|WEBHOOK_SECRET|ACCESS_KEY|API_KEY|APIKEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|(^|_)TOKEN($|_))/;

/** Names that contain a secret-looking word but are public by design. */
const PUBLIC_ALLOW = /(ANON|PUBLISHABLE|CLIENT_ID|SITE_URL|PROJECT_ID|APP_ID|MEASUREMENT_ID|AUTH_DOMAIN|SENDER_ID|STORAGE_BUCKET|PUBLIC_KEY|PUBKEY|SITE_KEY|RECAPTCHA|TURNSTILE|MAPBOX|POSTHOG|SENTRY_DSN|GA_|GTM_|PUBLIC_TOKEN|ANALYTICS)/;

const VAR_RE = new RegExp(`\\b(${PUBLIC_PREFIXES.join("|")})([A-Z0-9_]+)\\b`, "g");

export function isSuspiciousPublicVar(name: string): boolean {
  const prefix = PUBLIC_PREFIXES.find((p) => name.startsWith(p));
  if (!prefix) return false;
  const rest = name.slice(prefix.length);
  if (PUBLIC_ALLOW.test(rest)) return false;
  return SECRET_WORDS.test(rest);
}

const CODE_OR_CONFIG = new Set(["client", "server", "config", "env", "other"]);
const EXAMPLE_ENV = /\.env(\.[\w.-]+)?\.(example|sample|template|dist)$/i;

export const secretPublicEnvRule: Rule = {
  id: "GSK-SECRET-002",
  title: "Server secret exposed to the client bundle through a public env prefix",
  severity: "CRITICAL",
  description:
    "Variables prefixed NEXT_PUBLIC_, VITE_, REACT_APP_, EXPO_PUBLIC_, NUXT_PUBLIC_ or PUBLIC_ are inlined into browser code. This one is named like a secret.",
  action:
    "Rename the variable without the public prefix, read it only in server code (API route, server action, edge function), and rotate the value since it may already have shipped.",
  appliesTo: (file) => CODE_OR_CONFIG.has(file.fileClass) && !/\.(md|mdx|txt)$/i.test(file.path) && !EXAMPLE_ENV.test(file.path),
  check: ({ file }) => {
    const matches: RuleMatch[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i] ?? "";
      if (line.length > 5000) continue;
      VAR_RE.lastIndex = 0;
      for (const m of line.matchAll(VAR_RE)) {
        const name = m[0];
        if (!isSuspiciousPublicVar(name) || seen.has(name)) continue;
        // In dotenv files, a Mapbox-style public token (pk.) is not a secret.
        if (file.fileClass === "env") {
          const value = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
          if (/^pk[._]/.test(value)) continue;
        }
        seen.add(name);
        matches.push({
          line: i + 1,
          // Code lines may carry a hardcoded fallback value next to the variable; never show it.
          snippet: file.fileClass === "env" ? redactEnvLine(line) : sanitize(maskQuotedLiterals(line.trim()), 160),
          message: `"${name}" is inlined into the client bundle and its name indicates a secret.`,
          details: { variable: name },
        });
      }
    }
    return matches;
  },
};

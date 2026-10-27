import { sanitize } from "../report/text.js";

/** Shows the first 4 characters and the length; never the value. */
export function redactSecret(value: string): string {
  const head = value.slice(0, 4);
  return `${head}…[${value.length} chars]`;
}

/** Replaces every occurrence of `secret` in `line` with its redaction, then sanitizes. */
export function redactInLine(line: string, secrets: string[], max = 160): string {
  let out = line.trim();
  for (const s of secrets) {
    if (s.length === 0) continue;
    out = out.split(s).join(redactSecret(s));
  }
  return sanitize(out, max);
}

/** For dotenv lines: keeps the key, hides the value entirely. */
export function redactEnvLine(line: string, max = 160): string {
  const trimmed = line.trim();
  const eq = trimmed.indexOf("=");
  if (eq === -1) return sanitize(trimmed, max);
  const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  return sanitize(`${trimmed.slice(0, eq)}=${value.length === 0 ? "" : `<redacted ${value.length} chars>`}`, max);
}

/** Shannon entropy in bits per character. */
export function entropyBitsPerChar(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / value.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PLACEHOLDER = /x{5,}|X{5,}|your[-_ ]?|example|placeholder|changeme|change[-_]me|redacted|\*{3,}|0{8,}|1234567|dummy|sample|<[^>]+>/i;

export function looksLikePlaceholder(token: string): boolean {
  return PLACEHOLDER.test(token);
}

/**
 * Masks the contents of quoted string literals of at least `minLen` characters
 * so a code snippet never carries a hardcoded value (passwords, tokens).
 * Short literals such as '*' or 'utf8' stay readable.
 */
export function maskQuotedLiterals(line: string, minLen = 8): string {
  return line.replace(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g, (whole, quote: string, inner: string) => {
    if (inner.length < minLen) return whole;
    return `${quote}<redacted ${inner.length} chars>${quote}`;
  });
}

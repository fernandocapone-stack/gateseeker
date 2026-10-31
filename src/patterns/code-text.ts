/**
 * Mentions versus uses. A variable name inside a sentence ("Never put
 * SERVICE_ROLE in the browser") or inside a regular expression
 * (/(ANON|PUBLIC_TOKEN)/) is text about the variable, not a read of it.
 * `blankMentions` returns a JavaScript/TypeScript line with those two kinds
 * of text emptied, so name-based rules (GSK-SECRET-002, GSK-SUPABASE-002)
 * only see code. Kept as is: string literals without whitespace (a quoted
 * variable name such as "SUPABASE_SERVICE_ROLE_KEY" is still a use), template
 * literals with interpolation, and comments.
 *
 * Line-based and linear: one pass, no backtracking. A string or regular
 * expression that spans lines is left untouched, which errs on the side of
 * reporting.
 */

const JS_LIKE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i;

export function isJsLike(path: string): boolean {
  return JS_LIKE.test(path);
}

/** Characters after which a `/` starts a regular expression rather than a division. */
// Not < or >: in JSX, </div> would otherwise start a "regular expression" that swallows the code up to the next tag.
const REGEX_AFTER = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^"]);

/**
 * Whether a `/` starts a regular expression, judged from the last significant
 * text before it (at most 16 characters, trailing blanks trimmed), so the
 * check is constant-time.
 */
function regexAllowed(tail: string): boolean {
  if (tail === "") return true;
  if (/(?:^|[^\w$])(?:return|typeof|case|in|of|void|throw)$/.test(tail)) return true;
  return REGEX_AFTER.has(tail[tail.length - 1] ?? "");
}

export function blankMentions(line: string): string {
  // Plain text is copied in runs (line.slice), and a short tail of what was written is kept apart:
  // per-character appends, or reading the end of a string built with +=, would make long lines slow.
  const out: string[] = [];
  let runStart = 0;
  const push = (s: string): void => {
    out.push(s);
  };
  /** The last 16 significant characters written so far, read back from the last chunks only when a `/` needs it. */
  const tailOf = (pending: string): string => {
    let acc = pending.trimEnd();
    for (let k = out.length - 1; k >= 0 && acc.length < 16; k--) acc = `${(out[k] ?? "").slice(-32)}${acc}`.trimEnd();
    return acc.slice(-16);
  };
  const flush = (to: number): void => {
    if (to > runStart) push(line.slice(runStart, to));
  };
  let i = 0;
  // After one unterminated scan for a regular expression, no later one is tried: keeps the pass linear.
  let regexPossible = true;
  while (i < line.length) {
    const c = line[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
      flush(i);
      if (j >= line.length) {
        // Unterminated on this line (multi-line template, for instance): keep the rest.
        push(line.slice(i));
        runStart = line.length;
        break;
      }
      const inner = line.slice(i + 1, j);
      // An apostrophe in JSX text can pair with a later one; never blank a stretch that reads the environment.
      const prose = /\s/.test(inner) && !(c === "`" && inner.includes("${")) && !/\benv\b/.test(inner);
      push(prose ? c + c : line.slice(i, j + 1));
      i = j + 1;
      runStart = i;
      continue;
    }
    if (c === "/" && line[i + 1] === "/") break;
    if (regexPossible && c === "/" && line[i + 1] !== "*" && regexAllowed(tailOf(line.slice(Math.max(runStart, i - 32), i)))) {
      let j = i + 1;
      let inClass = false;
      while (j < line.length) {
        const d = line[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        j += 1;
      }
      if (j < line.length) {
        flush(i);
        push("//");
        i = j + 1;
        while (i < line.length && /[a-z]/.test(line[i] ?? "")) i += 1;
        runStart = i;
        continue;
      }
      regexPossible = false;
    }
    i += 1;
  }
  // The rest, including a trailing comment, is kept as written.
  if (runStart < line.length) out.push(line.slice(runStart));
  return out.join("");
}

/**
 * Minimal .gitignore matcher: enough to answer "does the root .gitignore cover
 * this path?" for the common patterns found in JavaScript projects.
 *
 * Supported: blank lines and comments, `name`, `name/` (directory only),
 * `/anchored`, `dir/sub`, `*`, `?`, `**`, and `[abc]` classes.
 * Not supported (documented limitation): negation (`!pattern`) is ignored,
 * nested .gitignore files are not read, and `**` edge cases follow a simple
 * interpretation. The matcher only ever reads text; it never runs git.
 */

interface CompiledPattern {
  regex: RegExp;
  dirOnly: boolean;
}

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // `**/` matches zero or more directories; trailing `**` matches anything.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end === -1) {
        out += "\\[";
      } else {
        out += `[${glob.slice(i + 1, end).replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else if (ch !== undefined && /[.+^${}()|\\]/.test(ch)) {
      out += `\\${ch}`;
    } else if (ch !== undefined) {
      out += ch;
    }
  }
  return out;
}

export function compileGitignore(text: string): CompiledPattern[] {
  const patterns: CompiledPattern[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;

    let pattern = line;
    let dirOnly = false;
    if (pattern.endsWith("/")) {
      dirOnly = true;
      pattern = pattern.slice(0, -1);
    }
    const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
    if (pattern.startsWith("/")) pattern = pattern.slice(1);

    const body = globToRegex(pattern);
    // Unanchored patterns match at any depth; all patterns also match
    // everything underneath a matched directory.
    const prefix = anchored ? "^" : "^(?:.*/)?";
    patterns.push({ regex: new RegExp(`${prefix}${body}(?:/.*)?$`), dirOnly });
  }
  return patterns;
}

export function makeGitignoreMatcher(text: string | null): (relPath: string) => boolean {
  if (text === null) return () => false;
  const patterns = compileGitignore(text);
  return (relPath: string): boolean => {
    const p = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
    for (const { regex, dirOnly } of patterns) {
      if (!regex.test(p)) continue;
      if (!dirOnly) return true;
      // Directory-only patterns match a path only through a directory segment.
      const m = regex.exec(p);
      if (m && m[0].length < p.length) return true;
      if (m && p.includes("/")) return true;
    }
    return false;
  };
}

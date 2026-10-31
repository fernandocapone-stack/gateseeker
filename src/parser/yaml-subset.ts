/**
 * A reader for the subset of YAML that pnpm-lock.yaml (v9) and Yarn Berry's
 * yarn.lock use: block mappings by indentation, block sequences of scalars,
 * plain, single- and double-quoted scalars, and flow collections ({...},
 * [...]) kept as their raw text for the caller to pick apart. No anchors,
 * aliases, tags, multi-document streams or type coercion: every scalar is a
 * string. It never evaluates anything.
 *
 * Untrusted input: lines are processed once (linear time), depth and node
 * count are capped, keys that could reach Object.prototype are refused, and
 * every map is created without a prototype.
 */

export type YamlValue = string | string[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}

export interface YamlLimits {
  maxDepth: number;
  maxNodes: number;
}

export const DEFAULT_YAML_LIMITS: YamlLimits = { maxDepth: 32, maxNodes: 500_000 };

export type YamlResult = { ok: true; value: YamlMap } | { ok: false; line: number; message: string };

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function newMap(): YamlMap {
  return Object.create(null) as YamlMap;
}

class YamlError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(message);
  }
}

function unquoteDouble(raw: string, line: number): string {
  // JSON's double-quoted escapes cover what lockfiles use (\" \\ \n \t \uXXXX).
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v === "string") return v;
  } catch {
    /* fall through */
  }
  throw new YamlError(line, "Malformed double-quoted string.");
}

function unquoteSingle(raw: string, line: number): string {
  if (raw.length < 2 || !raw.endsWith("'")) throw new YamlError(line, "Unterminated single-quoted string.");
  return raw.slice(1, -1).replace(/''/g, "'");
}

/** A scalar value: quotes removed, flow collections returned as written, trailing comments dropped. */
function scalar(raw: string, line: number): string {
  const v = raw.trim();
  if (v.startsWith('"')) return unquoteDouble(v, line);
  if (v.startsWith("'")) return unquoteSingle(v, line);
  if (v.startsWith("{") || v.startsWith("[")) return v;
  const hash = v.indexOf(" #");
  return (hash >= 0 ? v.slice(0, hash) : v).trim();
}

/** Splits "key: value" / "key:" / "'quoted key': value". Returns null when the line has no key. */
function splitKey(content: string, line: number): { key: string; rest: string } | null {
  if (content.startsWith('"') || content.startsWith("'")) {
    const quote = content[0] ?? "";
    let i = 1;
    for (; i < content.length; i++) {
      const c = content[i];
      if (quote === '"' && c === "\\") {
        i++;
        continue;
      }
      if (c === quote) {
        if (quote === "'" && content[i + 1] === "'") {
          i++;
          continue;
        }
        break;
      }
    }
    if (i >= content.length) throw new YamlError(line, "Unterminated quoted key.");
    const rawKey = content.slice(0, i + 1);
    const after = content.slice(i + 1);
    if (!after.startsWith(":")) return null;
    return { key: quote === '"' ? unquoteDouble(rawKey, line) : unquoteSingle(rawKey, line), rest: after.slice(1) };
  }
  const sep = content.indexOf(": ");
  if (sep >= 0) return { key: content.slice(0, sep).trim(), rest: content.slice(sep + 1) };
  if (content.endsWith(":")) return { key: content.slice(0, -1).trim(), rest: "" };
  return null;
}

export type YamlDocsResult = { ok: true; documents: YamlMap[] } | { ok: false; line: number; message: string };

/** Several documents separated by "---" lines (pnpm 11+ writes the package manager's own lock first). */
export function parseYamlDocuments(text: string, limits: YamlLimits = DEFAULT_YAML_LIMITS): YamlDocsResult {
  const lines = text.split(/\r?\n/);
  const documents: YamlMap[] = [];
  let start = 0;
  const flush = (end: number): YamlDocsResult | null => {
    const chunk = lines.slice(start, end);
    if (chunk.every((l) => l.trim() === "" || l.trim().startsWith("#"))) return null;
    const r = parseYamlSubset(chunk.join("\n"), limits);
    if (!r.ok) return { ok: false, line: r.line + start, message: r.message };
    documents.push(r.value);
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").trimEnd() !== "---") continue;
    const failed = flush(i);
    if (failed) return failed;
    start = i + 1;
  }
  const failed = flush(lines.length);
  return failed ?? { ok: true, documents };
}

export function parseYamlSubset(text: string, limits: YamlLimits = DEFAULT_YAML_LIMITS): YamlResult {
  try {
    return { ok: true, value: parse(text, limits) };
  } catch (e) {
    if (e instanceof YamlError) return { ok: false, line: e.line, message: e.message };
    throw e;
  }
}

function parse(text: string, limits: YamlLimits): YamlMap {
  const lines = text.split(/\r?\n/);
  const root = newMap();
  const stack: { indent: number; map: YamlMap }[] = [{ indent: 0, map: root }];
  let pending: { indent: number; map: YamlMap; key: string; line: number } | null = null;
  let seq: { indent: number; items: string[] } | null = null;
  let nodes = 0;

  const set = (map: YamlMap, key: string, value: YamlValue, line: number) => {
    if (FORBIDDEN_KEYS.has(key)) throw new YamlError(line, `Key "${key}" is not allowed.`);
    if (Object.prototype.hasOwnProperty.call(map, key)) throw new YamlError(line, `Duplicate key "${key.slice(0, 80)}".`);
    if (++nodes > limits.maxNodes) throw new YamlError(line, `More than ${String(limits.maxNodes)} entries.`);
    map[key] = value;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (i === 0 && trimmed === "---") continue;
    const lead = raw.length - raw.trimStart().length;
    if (raw.slice(0, lead).includes("\t")) throw new YamlError(lineNo, "Tabs are not allowed in indentation.");
    const indent = lead;
    const content = raw.slice(lead).trimEnd();

    // Block sequence item.
    if (content === "-" || content.startsWith("- ")) {
      if (pending && indent >= pending.indent) {
        const items: string[] = [];
        set(pending.map, pending.key, items, lineNo);
        seq = { indent, items };
        pending = null;
      }
      if (seq?.indent !== indent) throw new YamlError(lineNo, "Sequence item outside a sequence.");
      const item = content.slice(1).trim();
      if (item.includes(": ") || item.endsWith(":")) throw new YamlError(lineNo, "Mappings inside sequences are not supported.");
      if (++nodes > limits.maxNodes) throw new YamlError(lineNo, `More than ${String(limits.maxNodes)} entries.`);
      seq.items.push(scalar(item, lineNo));
      continue;
    }
    if (seq && indent <= seq.indent) seq = null;

    if (pending) {
      if (indent > pending.indent) {
        if (stack.length >= limits.maxDepth) throw new YamlError(lineNo, `Nesting deeper than ${String(limits.maxDepth)} levels.`);
        const child = newMap();
        set(pending.map, pending.key, child, pending.line);
        stack.push({ indent, map: child });
      } else {
        set(pending.map, pending.key, "", pending.line);
      }
      pending = null;
    }
    while (stack.length > 1 && (stack[stack.length - 1]?.indent ?? 0) > indent) stack.pop();
    const top = stack[stack.length - 1];
    if (top?.indent !== indent) throw new YamlError(lineNo, "Inconsistent indentation.");

    const kv = splitKey(content, lineNo);
    if (kv === null) throw new YamlError(lineNo, "Expected \"key: value\".");
    const value = kv.rest.trim();
    if (value === "") {
      pending = { indent, map: top.map, key: kv.key, line: lineNo };
      continue;
    }
    if (/^[|>][+-]?\d*$/.test(value)) {
      // Block scalar: keep the more-indented lines as text.
      const parts: string[] = [];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1] ?? "";
        const nextLead = nextLine.length - nextLine.trimStart().length;
        if (nextLine.trim() !== "" && nextLead <= indent) break;
        parts.push(nextLine.trim());
        i++;
      }
      set(top.map, kv.key, parts.join(value.startsWith(">") ? " " : "\n"), lineNo);
      continue;
    }
    set(top.map, kv.key, scalar(value, lineNo), lineNo);
  }
  if (pending) set(pending.map, pending.key, "", pending.line);
  return root;
}

/** Reads one field of a flow mapping kept as text, e.g. integrity from "{integrity: sha512-..., tarball: ...}". */
export function flowField(flow: string, field: string): string | null {
  if (!flow.startsWith("{")) return null;
  const body = flow.slice(1, flow.lastIndexOf("}") > 0 ? flow.lastIndexOf("}") : undefined);
  for (const part of body.split(",")) {
    const sep = part.indexOf(":");
    if (sep < 0) continue;
    if (part.slice(0, sep).trim() === field) {
      const v = part.slice(sep + 1).trim();
      return v.replace(/^['"]|['"]$/g, "");
    }
  }
  return null;
}

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * Minimal, dependency-free reader for the .tar.gz archives GitHub serves
 * for a repository. It is the most exposed piece of the hosted service, so
 * it is deliberately restrictive:
 *  - regular files and directories only; symbolic and hard links are rejected
 *    (an archive that contains one is refused as a whole);
 *  - absolute paths, ".." segments, backslashes and control characters are rejected;
 *  - limits on entry count, per-file size and total uncompressed size abort
 *    the extraction with a typed error; nothing is left half-written outside
 *    the destination;
 *  - GNU long names and PAX path headers are honoured so real GitHub
 *    archives (which use them for paths over 100 bytes) extract correctly;
 *  - the first path component (GitHub's `<repo>-<sha>/` prefix) is stripped.
 *
 * It never executes anything and never follows anything: it turns bytes into
 * files under one directory, and the scanner reads them as text afterwards.
 */

export interface TarLimits {
  /** Compressed input size the caller already enforced; checked again here. */
  maxCompressedBytes: number;
  /** Uncompressed archive size (gunzip output). */
  maxUncompressedBytes: number;
  /** Regular-file entries. */
  maxEntries: number;
  /** Largest single file written; larger files (binaries, media) are skipped, not fatal: the scanner ignores them anyway. */
  maxFileBytes: number;
}

export const DEFAULT_TAR_LIMITS: TarLimits = {
  maxCompressedBytes: 50 * 1024 * 1024,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxEntries: 20_000,
  maxFileBytes: 8 * 1024 * 1024,
};

export type TarErrorCode =
  | "compressed-too-large"
  | "uncompressed-too-large"
  | "not-gzip"
  | "malformed"
  | "too-many-entries"
  | "link-entry"
  | "unsafe-path"
  | "unsupported-entry";

export interface TarError {
  code: TarErrorCode;
  message: string;
}

export interface TarExtractResult {
  files: number;
  directories: number;
  bytes: number;
  /** Regular files above maxFileBytes that were not written. */
  skippedLarge: number;
  /** sha256 of the uncompressed archive, for the cache key and the report. */
  sha256: string;
  /** The stripped top-level directory name, e.g. "repo-abc123". */
  prefix: string | null;
}

export type ExtractResult = { ok: true; value: TarExtractResult } | { ok: false; error: TarError };

const BLOCK = 512;

function cstr(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString("utf8");
}

function octal(buf: Buffer, start: number, len: number): number | null {
  const first = buf[start] ?? 0;
  // GNU base-256 encoding for sizes >= 8 GiB: refuse outright, it is always above our limits.
  if (first & 0x80) return null;
  const text = cstr(buf, start, len).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  return parseInt(text, 8);
}

function isZeroBlock(buf: Buffer, at: number): boolean {
  for (let i = at; i < at + BLOCK; i++) if (buf[i] !== 0) return false;
  return true;
}

function checksumOk(buf: Buffer, at: number): boolean {
  const declared = octal(buf, at + 148, 8);
  if (declared === null) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (buf[at + i] ?? 0);
  return sum === declared;
}

/** Splits a tar path into segments, refusing anything that could escape or confuse the destination. */
function safeSegments(path: string): string[] | null {
  if (path.length === 0 || path.length > 4096) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(path)) return null;
  if (path.startsWith("/")) return null;
  if (/^[A-Za-z]:/.test(path)) return null;
  const segs = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) return null;
  // Names Windows cannot create; the service runs on Linux, but tests run here too.
  if (segs.some((s) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s) || /[:*?"<>|]/.test(s) || s.endsWith(" ") || s.endsWith("."))) return null;
  return segs;
}

function parsePax(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    if (sp === -1) break;
    const len = parseInt(buf.subarray(i, sp).toString("ascii"), 10);
    if (!Number.isFinite(len) || len <= 0 || i + len > buf.length) break;
    const record = buf.subarray(sp + 1, i + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0) out.set(record.slice(0, eq), record.slice(eq + 1));
    i += len;
  }
  return out;
}

/**
 * Extracts a gzipped tar archive into `destDir` (which must exist and be
 * empty). On any error the caller should delete `destDir`; this function
 * does not try to roll back partial writes, it only guarantees nothing was
 * written outside `destDir`.
 */
export function extractTarGz(gz: Buffer, destDir: string, limits: TarLimits = DEFAULT_TAR_LIMITS): ExtractResult {
  if (gz.length > limits.maxCompressedBytes) return { ok: false, error: { code: "compressed-too-large", message: `Archive is larger than ${limits.maxCompressedBytes} bytes compressed.` } };
  if (gz.length < 2 || gz[0] !== 0x1f || gz[1] !== 0x8b) return { ok: false, error: { code: "not-gzip", message: "Archive is not gzip data." } };

  let tar: Buffer;
  try {
    tar = gunzipSync(gz, { maxOutputLength: limits.maxUncompressedBytes });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|exceeds/i.test(err.message ?? "")) {
      return { ok: false, error: { code: "uncompressed-too-large", message: `Archive expands to more than ${limits.maxUncompressedBytes} bytes.` } };
    }
    return { ok: false, error: { code: "not-gzip", message: "Archive could not be decompressed." } };
  }
  if (tar.length % BLOCK !== 0) return { ok: false, error: { code: "malformed", message: "Archive length is not a multiple of 512 bytes." } };

  const root = resolve(destDir);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  let files = 0;
  let directories = 0;
  let bytes = 0;
  let skippedLarge = 0;
  let prefix: string | null = null;
  let longName: string | null = null;
  let paxPath: string | null = null;
  let at = 0;

  while (at + BLOCK <= tar.length) {
    if (isZeroBlock(tar, at)) break; // end-of-archive marker
    if (!checksumOk(tar, at)) return { ok: false, error: { code: "malformed", message: `Bad header checksum at offset ${at}.` } };
    const size = octal(tar, at + 124, 12);
    if (size === null) return { ok: false, error: { code: "malformed", message: `Unreadable entry size at offset ${at}.` } };
    const type = String.fromCharCode(tar[at + 156] ?? 0);
    const magic = cstr(tar, at + 257, 6);
    let name = cstr(tar, at, 100);
    const ustarPrefix = magic.startsWith("ustar") ? cstr(tar, at + 345, 155) : "";
    if (ustarPrefix) name = `${ustarPrefix}/${name}`;
    const dataStart = at + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) return { ok: false, error: { code: "malformed", message: "Archive is truncated." } };
    const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    // Metadata entries that only affect the next header.
    if (type === "L") {
      longName = cstr(tar, dataStart, size);
      at = next;
      continue;
    }
    if (type === "x") {
      paxPath = parsePax(tar.subarray(dataStart, dataEnd)).get("path") ?? null;
      at = next;
      continue;
    }
    if (type === "g" || type === "K") {
      // Global PAX header / GNU long link target: neither changes what we write.
      at = next;
      continue;
    }

    const effectiveName = paxPath ?? longName ?? name;
    longName = null;
    paxPath = null;

    if (type === "1" || type === "2") return { ok: false, error: { code: "link-entry", message: `Archive contains a ${type === "1" ? "hard" : "symbolic"} link (${effectiveName.slice(0, 200)}); links are not allowed.` } };
    const isDir = type === "5" || (type === "0" && effectiveName.endsWith("/"));
    const isFile = type === "0" || type === "\0" || type === "7";
    if (!isDir && !isFile) return { ok: false, error: { code: "unsupported-entry", message: `Archive contains an unsupported entry type '${type}' (${effectiveName.slice(0, 200)}).` } };

    const segs = safeSegments(effectiveName);
    if (segs === null) return { ok: false, error: { code: "unsafe-path", message: `Archive contains an unsafe path (${effectiveName.slice(0, 200)}).` } };
    if (segs.length === 0) {
      at = next;
      continue;
    }
    // GitHub archives wrap everything in one top-level directory; strip it consistently.
    const top = segs[0] ?? "";
    prefix ??= top;
    if (top !== prefix) return { ok: false, error: { code: "unsafe-path", message: "Archive has more than one top-level directory." } };
    const rel = segs.slice(1);
    if (rel.length === 0) {
      at = next;
      continue;
    }
    const target = resolve(root, join(...rel));
    if (!target.startsWith(rootWithSep)) return { ok: false, error: { code: "unsafe-path", message: `Archive entry resolves outside the destination (${effectiveName.slice(0, 200)}).` } };

    if (isDir) {
      mkdirSync(target, { recursive: true });
      directories++;
    } else {
      if (size > limits.maxFileBytes) {
        skippedLarge++;
        at = next;
        continue;
      }
      files++;
      if (files > limits.maxEntries) return { ok: false, error: { code: "too-many-entries", message: `Archive has more than ${limits.maxEntries} files.` } };
      bytes += size;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, tar.subarray(dataStart, dataEnd), { flag: "wx" });
    }
    at = next;
  }

  const sha256 = createHash("sha256").update(tar).digest("hex");
  return { ok: true, value: { files, directories, bytes, skippedLarge, sha256, prefix } };
}

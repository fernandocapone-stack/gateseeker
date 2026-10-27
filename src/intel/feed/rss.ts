import { sanitize } from "../../report/text.js";

/**
 * Minimal RSS 2.0 / Atom parser for the collector.
 *
 * Deliberately not a general XML parser: it extracts item/entry blocks and
 * their title, link and date with bounded regular expressions, refuses any
 * document that declares a DOCTYPE or ENTITY (no external entity processing,
 * ever), strips tags and decodes a small set of entities. Feed content is
 * untrusted input; nothing beyond these three fields is retained.
 */

export interface FeedEntry {
  title: string;
  link: string;
  /** ISO date when parseable, else null. */
  publishedAt: string | null;
}

export type FeedParseResult = { ok: true; kind: "rss" | "atom"; entries: FeedEntry[] } | { ok: false; error: string };

const MAX_ENTRIES = 200;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_m, dec: string) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}

export function stripTags(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]{0,500}>/g, " ").replace(/\s+/g, " ").trim();
}

function textOf(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]{0,300})?>([\\s\\S]{0,5000}?)<\\/${tag}>`, "i");
  const m = re.exec(block);
  return m?.[1] !== undefined ? sanitize(decodeEntities(stripTags(m[1])), 300) : null;
}

function atomLink(block: string): string | null {
  // Prefer rel="alternate"; fall back to the first href.
  const links = [...block.matchAll(/<link\b([^>]{0,500})\/?>/gi)].map((m) => m[1] ?? "");
  const pick = links.find((a) => /rel\s*=\s*["']alternate["']/i.test(a)) ?? links.find((a) => !/rel\s*=/i.test(a)) ?? links[0];
  const href = pick === undefined ? null : /href\s*=\s*["']([^"']{1,2000})["']/i.exec(pick)?.[1];
  return href ? decodeEntities(href.trim()) : null;
}

function toIso(text: string | null): string | null {
  if (text === null) return null;
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseFeed(xml: string): FeedParseResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    return { ok: false, error: "feed declares a DOCTYPE or ENTITY; refused" };
  }
  const head = xml.slice(0, 2000);
  const isAtom = /<feed\b/i.test(head) && !/<rss\b/i.test(head);
  const isRss = /<rss\b|<rdf:RDF\b|<channel\b/i.test(head);
  if (!isAtom && !isRss) return { ok: false, error: "not an RSS or Atom document" };

  const blockRe = isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const entries: FeedEntry[] = [];
  for (const m of xml.matchAll(blockRe)) {
    if (entries.length >= MAX_ENTRIES) break;
    const block = m[1] ?? "";
    const title = textOf(block, "title");
    let link: string | null;
    if (isAtom) link = atomLink(block);
    else link = textOf(block, "link") ?? textOf(block, "guid");
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    const date = isAtom ? (textOf(block, "published") ?? textOf(block, "updated")) : (textOf(block, "pubDate") ?? textOf(block, "dc:date"));
    entries.push({ title, link: link.slice(0, 2000), publishedAt: toIso(date) });
  }
  return { ok: true, kind: isAtom ? "atom" : "rss", entries };
}

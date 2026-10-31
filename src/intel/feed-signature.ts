import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature of a published advisory set (docs/SPRINT_6.md 3.5). The feed
 * workflow signs the approved set with a key that only it and the service
 * know; the service checks the signature when the set arrives and again every
 * time it loads the set from the database, so a row changed in the database
 * is never used.
 *
 * The signed text binds the publication time, the digest and the exact
 * payload bytes. The time lets the service refuse an old signed set sent
 * again to roll the feed back.
 */

export const FEED_SIGNATURE_VERSION = "gateseeker-feed-v1";

/** Shortest key accepted: 32 characters, like CRON_SECRET. */
export const MIN_FEED_KEY_LENGTH = 32;

export interface SignedFeed {
  publishedAt: string;
  digest: string;
  payload: string;
  signature: string;
}

function signedText(publishedAt: string, digest: string, payload: string): string {
  return `${FEED_SIGNATURE_VERSION}\n${publishedAt}\n${digest}\n${payload}`;
}

export function signFeed(key: string, publishedAt: string, digest: string, payload: string): string {
  return createHmac("sha256", key).update(signedText(publishedAt, digest, payload)).digest("hex");
}

export function verifyFeed(key: string, feed: SignedFeed): boolean {
  if (!/^[0-9a-f]{64}$/.test(feed.signature)) return false;
  const expected = Buffer.from(signFeed(key, feed.publishedAt, feed.digest, feed.payload), "hex");
  return timingSafeEqual(expected, Buffer.from(feed.signature, "hex"));
}

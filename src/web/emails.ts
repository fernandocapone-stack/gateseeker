import { createHmac, timingSafeEqual } from "node:crypto";

import { sanitize } from "../report/text.js";
import type { Finding } from "../types.js";
import type { EmailKind, EmailMessage } from "./mail.js";

/**
 * The three emails of the monitor (docs/SPRINT_6.md 3.6): follow confirmation,
 * alert of new P1/P2 findings, monitoring paused. Plain text plus a minimal
 * HTML version. Content is a closed list of fields: the repository name, a
 * count, and per finding its priority, identifier and a label that is either
 * our own rule text or the package name. Never a code snippet, a file path, a
 * third-party summary or anything else read from the repository. Every value
 * is cleaned for the text version and escaped for the HTML one, and every link
 * points to the Gateseeker site, built only from validated ids.
 */

export interface AlertItem {
  priority: "P1" | "P2";
  id: string;
  label: string;
}

/** What the monitor keeps on the follow until the alert is sent (one email per repository per day). */
export interface PendingAlert {
  reportId: string;
  count: number;
  items: AlertItem[];
}

export const MAX_ALERT_ITEMS = 10;

export function alertItem(f: Finding): AlertItem | null {
  if (f.priority !== "P1" && f.priority !== "P2") return null;
  const e = f.evidence;
  const id = e.kind === "insecure-pattern" ? e.ruleId : e.kind === "supply-chain-anomaly" ? (e.advisoryId ?? e.ruleId ?? "") : e.vulnerabilityId;
  // Pattern titles and supply-chain types are our own text; for a vulnerable dependency, the package name (not the third-party summary).
  const label = e.kind === "insecure-pattern" ? e.title : e.kind === "supply-chain-anomaly" ? `${e.type} in ${f.subject}` : `vulnerable dependency ${f.subject}`;
  return { priority: f.priority, id: sanitize(id, 60), label: sanitize(label, 120) };
}

/** Adds the findings of a newer rescan to an alert that has not been sent yet. */
export function mergeAlert(pending: PendingAlert | null, next: PendingAlert): PendingAlert {
  if (!pending) return { ...next, items: next.items.slice(0, MAX_ALERT_ITEMS) };
  const items = [...pending.items];
  for (const i of next.items) if (!items.some((x) => x.id === i.id && x.label === i.label)) items.push(i);
  return { reportId: next.reportId, count: pending.count + next.count, items: items.slice(0, MAX_ALERT_ITEMS) };
}

const UNSUBSCRIBE_VERSION = "gateseeker-unsubscribe-v1";

/** One-click unsubscribe token for one follow: HMAC, no expiry (docs/SPRINT_6.md 3.6). */
export function unsubscribeToken(key: string, followId: string): string {
  return createHmac("sha256", key).update(`${UNSUBSCRIBE_VERSION}\n${followId}`).digest("hex").slice(0, 32);
}

export function verifyUnsubscribe(key: string, followId: string, token: string): boolean {
  if (!/^[0-9a-f]{32}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(unsubscribeToken(key, followId), "hex"), Buffer.from(token, "hex"));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface EmailContext {
  to: string;
  owner: string;
  repo: string;
  followId: string;
  /** The site's public address, already validated (https, or http on localhost). */
  baseUrl: string;
  /** Key of the unsubscribe tokens. */
  key: string;
}

function links(c: EmailContext): { unsubscribePage: string; unsubscribeApi: string } {
  const q = new URLSearchParams({ f: c.followId, t: unsubscribeToken(c.key, c.followId) }).toString();
  return { unsubscribePage: `${c.baseUrl}/unsubscribe?${q}`, unsubscribeApi: `${c.baseUrl}/api/unsubscribe?${q}` };
}

function compose(kind: EmailKind, c: EmailContext, subject: string, paragraphs: { text: string; html: string }[]): EmailMessage {
  const { unsubscribePage, unsubscribeApi } = links(c);
  const footer = "You get this because you follow this repository on Gateseeker. Stop the daily check and these emails for this repository:";
  const text = [...paragraphs.map((p) => p.text), `${footer}\n${unsubscribePage}`].join("\n\n");
  const html = [
    '<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">',
    ...paragraphs.map((p) => p.html),
    `<p style="color:#555;font-size:13px">${escapeHtml(footer)} <a href="${escapeHtml(unsubscribePage)}">stop following</a>.</p>`,
    "</body></html>",
  ].join("\n");
  return { kind, to: c.to, subject: sanitize(subject, 150), text, html, headers: { "List-Unsubscribe": `<${unsubscribeApi}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } };
}

function name(c: EmailContext): string {
  return sanitize(`${c.owner}/${c.repo}`, 140);
}

function p(text: string): { text: string; html: string } {
  return { text, html: `<p>${escapeHtml(text)}</p>` };
}

export function followConfirmationEmail(c: EmailContext): EmailMessage {
  const n = name(c);
  return compose("follow_confirm", c, `You follow ${n} on Gateseeker`, [
    p(`You now follow ${n}. Gateseeker analyzes it again every day and emails you when a check finds new findings to fix soon (priority P1 or P2), at most once a day for this repository.`),
    p("The first check only records where the repository stands; alerts start with the checks after it."),
  ]);
}

export function alertEmail(c: EmailContext, alert: PendingAlert): EmailMessage {
  const n = name(c);
  const reportUrl = /^[A-Za-z0-9-]{1,64}$/.test(alert.reportId) ? `${c.baseUrl}/r/${alert.reportId}?from=email` : `${c.baseUrl}/app/scans`;
  const count = `${String(alert.count)} new finding${alert.count === 1 ? "" : "s"} to fix soon`;
  const more = alert.count > alert.items.length ? alert.count - alert.items.length : 0;
  // Cleaned again here: a pending alert comes back from the database.
  const lines = alert.items.map((i) => `${i.priority === "P1" ? "P1" : "P2"} · ${sanitize(i.id, 60)} · ${sanitize(i.label, 120)}`);
  return compose("alert", c, `${n}: ${count}`, [
    p(`Gateseeker analyzed ${n} again and found ${count} (priority P1 or P2) since the previous check:`),
    {
      text: [...lines.map((l) => `- ${l}`), ...(more > 0 ? [`- and ${String(more)} more`] : [])].join("\n"),
      html: `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}${more > 0 ? `<li>and ${String(more)} more</li>` : ""}</ul>`,
    },
    { text: `Open the report to see what to fix and how:\n${reportUrl}`, html: `<p><a href="${escapeHtml(reportUrl)}">Open the report</a> to see what to fix and how.</p>` },
  ]);
}

export function pausedEmail(c: EmailContext, reason: string): EmailMessage {
  const n = name(c);
  return compose("paused", c, `Gateseeker stopped checking ${n}`, [
    p(`Gateseeker stopped the daily check of ${n}: ${sanitize(reason, 120)}`),
    p("Gateseeker analyzes public repositories only. If the repository is public again, analyze it and press Follow to resume."),
  ]);
}

import { useCallback, useEffect, useState } from "react";

/**
 * Workspace notifications: one entry per analysis this account ran in this
 * browser (finished, incomplete or refused), plus the two preferences shown
 * in Settings. Everything lives in localStorage under the account id; the
 * service stores nothing for this, so another browser starts empty.
 * Stored values are re-checked on read (they are only our own data, but a
 * malformed entry must not break the page) and rendered as text only.
 */

export type NotificationKind = "finished" | "incomplete" | "refused";

export interface WorkspaceNotification {
  id: string;
  kind: NotificationKind;
  /** "owner/repo@sha7" when the service answered, otherwise the URL as typed. */
  subject: string;
  verdict: "pass" | "fail" | "incomplete" | null;
  p1: number;
  p2: number;
  /** Saved report id, null when nothing was saved. */
  reportId: string | null;
  /** One sentence: the gate reason or the refusal message. */
  message: string;
  at: string;
  read: boolean;
}

export interface NotificationPrefs {
  /** Record a notification when an analysis ends. */
  enabled: boolean;
  /** Only record finished analyses that have P1 or P2 findings (incomplete and refused are always recorded). */
  onlyUrgent: boolean;
}

const MAX = 50;
const EVENT = "gateseeker:notifications";
const DEFAULT_PREFS: NotificationPrefs = { enabled: true, onlyUrgent: false };

const listKey = (user: string) => `gateseeker:notifications:${user}`;
const prefsKey = (user: string) => `gateseeker:notification-prefs:${user}`;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: notifications are a convenience, the analysis itself is unaffected.
  }
  window.dispatchEvent(new Event(EVENT));
}

function isNotification(v: unknown): v is WorkspaceNotification {
  if (typeof v !== "object" || v === null) return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    (n.kind === "finished" || n.kind === "incomplete" || n.kind === "refused") &&
    typeof n.subject === "string" &&
    (n.verdict === null || n.verdict === "pass" || n.verdict === "fail" || n.verdict === "incomplete") &&
    typeof n.p1 === "number" &&
    typeof n.p2 === "number" &&
    (n.reportId === null || (typeof n.reportId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(n.reportId))) &&
    typeof n.message === "string" &&
    typeof n.at === "string" &&
    typeof n.read === "boolean"
  );
}

export function readNotifications(user: string): WorkspaceNotification[] {
  const v = readJson(listKey(user));
  return Array.isArray(v) ? v.filter(isNotification).slice(0, MAX) : [];
}

export function readPrefs(user: string): NotificationPrefs {
  const v = readJson(prefsKey(user));
  if (typeof v !== "object" || v === null) return DEFAULT_PREFS;
  const p = v as Record<string, unknown>;
  return {
    enabled: typeof p.enabled === "boolean" ? p.enabled : DEFAULT_PREFS.enabled,
    onlyUrgent: typeof p.onlyUrgent === "boolean" ? p.onlyUrgent : DEFAULT_PREFS.onlyUrgent,
  };
}

export function writePrefs(user: string, prefs: NotificationPrefs): void {
  writeJson(prefsKey(user), prefs);
}

/** Records the end of an analysis, honouring the account's preferences. */
export function notify(user: string, entry: Omit<WorkspaceNotification, "id" | "at" | "read">): void {
  const prefs = readPrefs(user);
  if (!prefs.enabled) return;
  if (prefs.onlyUrgent && entry.kind === "finished" && entry.p1 + entry.p2 === 0) return;
  const item: WorkspaceNotification = { ...entry, id: `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), read: false };
  writeJson(listKey(user), [item, ...readNotifications(user)].slice(0, MAX));
}

export function useNotifications(user: string | null) {
  const [items, setItems] = useState<WorkspaceNotification[]>(() => (user ? readNotifications(user) : []));
  const [prefs, setPrefsState] = useState<NotificationPrefs>(() => (user ? readPrefs(user) : DEFAULT_PREFS));

  useEffect(() => {
    if (!user) return;
    const sync = () => {
      setItems(readNotifications(user));
      setPrefsState(readPrefs(user));
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [user]);

  const markAllRead = useCallback(() => {
    if (user) writeJson(listKey(user), readNotifications(user).map((n) => ({ ...n, read: true })));
  }, [user]);
  const clear = useCallback(() => {
    if (user) writeJson(listKey(user), []);
  }, [user]);
  const setPrefs = useCallback((next: NotificationPrefs) => {
    if (user) writePrefs(user, next);
  }, [user]);

  return { items, unread: items.filter((n) => !n.read).length, prefs, markAllRead, clear, setPrefs };
}

/** "just now", "15 min ago", "3 h ago", then the date and time ("10 Oct, 18:41"). */
export function formatWhen(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const minutes = Math.floor((now - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)} min ago`;
  if (minutes < 24 * 60) return `${String(Math.floor(minutes / 60))} h ago`;
  const d = new Date(t);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

import { useEffect, useState } from "react";

import { fetchScans } from "./api";

/**
 * Analyses this account completed in this browser, newest first: the data
 * behind the Dashboard. Recorded for every report the service returns,
 * independently of the notification preferences. localStorage only (the
 * service has no "list my reports" endpoint), so another browser starts
 * empty. Entries are re-checked on read and rendered as text only.
 */

export interface AnalysisRecord {
  owner: string;
  repo: string;
  sha: string;
  verdict: "pass" | "fail" | "incomplete";
  byPriority: { P1: number; P2: number; P3: number; P4: number };
  reportId: string | null;
  at: string;
}

const MAX = 100;
const EVENT = "gateseeker:history";
const key = (user: string) => `gateseeker:history:${user}`;

function isRecord(v: unknown): v is AnalysisRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const p = r.byPriority as Record<string, unknown> | null | undefined;
  return (
    typeof r.owner === "string" &&
    typeof r.repo === "string" &&
    typeof r.sha === "string" &&
    (r.verdict === "pass" || r.verdict === "fail" || r.verdict === "incomplete") &&
    typeof p === "object" && p !== null &&
    ["P1", "P2", "P3", "P4"].every((k) => typeof p[k] === "number") &&
    (r.reportId === null || (typeof r.reportId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(r.reportId))) &&
    typeof r.at === "string"
  );
}

export function readHistory(user: string): AnalysisRecord[] {
  try {
    const raw = localStorage.getItem(key(user));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(v) ? v.filter(isRecord).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function recordAnalysis(user: string, entry: Omit<AnalysisRecord, "at">): void {
  const next = [{ ...entry, at: new Date().toISOString() }, ...readHistory(user)].slice(0, MAX);
  try {
    localStorage.setItem(key(user), JSON.stringify(next));
  } catch {
    // Storage blocked or full: the Dashboard stays as it was, the analysis itself is unaffected.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useHistory(user: string | null): AnalysisRecord[] {
  const [items, setItems] = useState<AnalysisRecord[]>(() => (user ? readHistory(user) : []));
  useEffect(() => {
    if (!user) return;
    const sync = () => { setItems(readHistory(user)); };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [user]);
  return items;
}

/** The newest analysis of each repository, newest first. */
export function latestPerRepository(items: AnalysisRecord[]): AnalysisRecord[] {
  const seen = new Set<string>();
  return items.filter((r) => {
    const k = `${r.owner}/${r.repo}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The account's history from the server (docs/SPRINT_6.md 3.1), with the
 * browser's copy shown first and kept as the fallback when the server cannot
 * answer. Refreshes after every analysis this tab records.
 */
export function useScanHistory(user: string | null, token: string | null): { records: AnalysisRecord[]; source: "server" | "browser" } {
  const local = useHistory(user);
  const [server, setServer] = useState<AnalysisRecord[] | null>(null);
  useEffect(() => {
    if (!user || !token) return;
    let cancelled = false;
    const load = () => {
      void fetchScans(token).then((r) => {
        if (cancelled || !r.ok) return;
        setServer(r.scans.map((s) => ({ owner: s.owner, repo: s.repo, sha: s.sha.slice(0, 7), verdict: s.verdict, byPriority: s.byPriority, reportId: s.reportId, at: s.at })).filter(isRecord));
      });
    };
    load();
    window.addEventListener(EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT, load);
    };
  }, [user, token]);
  return server ? { records: server, source: "server" } : { records: local, source: "browser" };
}

/**
 * Small hand-offs between workspace pages, kept in sessionStorage (a
 * convenience: losing them only drops a line of text or the back target).
 *
 *  - The note a finished analysis leaves for its saved report ("reused a
 *    report of this commit", "1 of 3 analyses used this hour"), shown once on
 *    /r/<id> after the analyze view navigates there.
 *  - The workspace page the analyze view returns to with its back button.
 */

export interface ScanNote {
  cached: boolean;
  used: number | null;
  limit: number | null;
}

const NOTE = "gateseeker:scan-note:";
const BACK = "gateseeker:analyze-back";

export function leaveScanNote(id: string, note: ScanNote): void {
  try {
    sessionStorage.setItem(NOTE + id, JSON.stringify(note));
  } catch {
    /* storage unavailable: the report shows without the note */
  }
}

/** Reads the note without removing it (React may render twice); clearScanNote removes it once shown. */
export function readScanNote(id: string): ScanNote | null {
  try {
    const raw = sessionStorage.getItem(NOTE + id);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<ScanNote>;
    return { cached: v.cached === true, used: typeof v.used === "number" ? v.used : null, limit: typeof v.limit === "number" ? v.limit : null };
  } catch {
    return null;
  }
}

export function clearScanNote(id: string): void {
  try {
    sessionStorage.removeItem(NOTE + id);
  } catch {
    /* nothing to clear */
  }
}

/** Remembers the last workspace page (only in-app paths). */
export function rememberWorkspacePath(path: string): void {
  if (!/^\/(app\/[a-z-]+|r\/[A-Za-z0-9-]{1,64})$/.test(path)) return;
  try {
    sessionStorage.setItem(BACK, path);
  } catch {
    /* falls back to the Dashboard */
  }
}

export function workspaceBackPath(): string {
  try {
    const v = sessionStorage.getItem(BACK);
    return v !== null && /^\/(app\/[a-z-]+|r\/[A-Za-z0-9-]{1,64})$/.test(v) ? v : "/app/dashboard";
  } catch {
    return "/app/dashboard";
  }
}

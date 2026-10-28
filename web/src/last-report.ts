import { useEffect, useState } from "react";

/**
 * The id of the last report saved in this tab, so the sidebar's "Issues" item
 * can open it. Kept in sessionStorage (a convenience: losing it only disables
 * the item) and broadcast to the shell with a window event.
 */

const KEY = "gateseeker:last-report";
const EVENT = "gateseeker:last-report";

export function setLastReportId(id: string): void {
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    // Storage blocked: the item stays disabled, nothing else depends on it.
  }
  window.dispatchEvent(new Event(EVENT));
}

function read(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useLastReportId(): string | null {
  const [id, setId] = useState(read);
  useEffect(() => {
    const on = () => { setId(read()); };
    window.addEventListener(EVENT, on);
    return () => { window.removeEventListener(EVENT, on); };
  }, []);
  return id;
}

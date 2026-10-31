import { Badge, Drawer, cn } from "@gateseeker/ui-kit";
import { ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { useCallback } from "react";

import { formatWhen, type WorkspaceNotification } from "../notifications";
import { Link } from "../router";

/**
 * Notifications side panel (Figma "Notifications"): one row per analysis that
 * ended in this browser, newest first. Unread rows sit on the page colour with
 * a blue marker; closing the panel marks them read. A row with a saved report
 * links to its scan page. All texts are rendered as text nodes.
 */

const ICON = { pass: ShieldCheck, fail: ShieldAlert, incomplete: ShieldQuestion, refused: ShieldX } as const;
const TONE = { pass: "text-success", fail: "text-destructive", incomplete: "text-warning", refused: "text-muted-foreground" } as const;

function status(n: WorkspaceNotification): keyof typeof ICON {
  if (n.kind === "refused") return "refused";
  if (n.kind === "incomplete" || n.verdict === "incomplete") return "incomplete";
  // Urgent findings show as an alert even when the CI gate would pass (code checks in warning mode).
  return n.verdict === "fail" || n.p1 + n.p2 > 0 ? "fail" : "pass";
}

function headline(n: WorkspaceNotification): string {
  if (n.kind === "refused") return "Analysis refused";
  if (status(n) === "incomplete") return "Analysis incomplete";
  if (n.p1 + n.p2 === 0) return "Analysis finished: no P1 or P2 findings";
  const parts = [n.p1 > 0 ? `${String(n.p1)} P1` : null, n.p2 > 0 ? `${String(n.p2)} P2` : null].filter(Boolean);
  return `Analysis finished: ${parts.join(", ")}`;
}

export function NotificationsPanel({ open, onClose, items, onMarkAllRead }: { open: boolean; onClose: () => void; items: WorkspaceNotification[]; onMarkAllRead: () => void }) {
  const close = useCallback(() => {
    onMarkAllRead();
    onClose();
  }, [onMarkAllRead, onClose]);

  return (
    <Drawer open={open} title="Notifications" onClose={close} closeLabel="Close notifications">
      {items.length === 0 ? (
        <div className="grid gap-1 rounded-lg border p-4">
          <p className="text-body font-medium">No notifications yet</p>
          <p className="text-label text-muted-foreground">When an analysis ends, it shows up here with its verdict and a link to the report. Kept in this browser only.</p>
        </div>
      ) : (
        <>
          <ul className="overflow-hidden rounded-lg border" aria-label="Notifications">
            {items.map((n) => {
              const s = status(n);
              const Icon = ICON[s];
              const body = (
                <>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-chip" aria-hidden="true">
                    <Icon className={cn("size-4", TONE[s])} />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-label font-light break-all text-muted-foreground">{n.subject}</span>
                      {s === "fail" && <Badge variant="critical">fail</Badge>}
                      {s === "incomplete" && <Badge variant="high">incomplete</Badge>}
                      {s === "pass" && <Badge variant="kind">pass</Badge>}
                      {s === "refused" && <Badge variant="kind">refused</Badge>}
                    </span>
                    <span className="text-body font-medium">{headline(n)}</span>
                    <span className="line-clamp-2 text-body text-muted-foreground">{n.message}</span>
                    <span className="text-caption text-muted-foreground">
                      <time dateTime={n.at}>{formatWhen(n.at)}</time>
                      {!n.read && <span className="sr-only">, unread</span>}
                    </span>
                  </span>
                  {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
                </>
              );
              const row = cn("flex gap-3 p-4", !n.read && "bg-background");
              return (
                <li key={n.id} className="border-b last:border-b-0">
                  {n.reportId ? (
                    <Link href={`/r/${n.reportId}`} onClick={close} className={cn(row, "hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}>
                      {body}
                    </Link>
                  ) : (
                    <div className={row}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-caption text-muted-foreground">Kept in this browser for this account, last 50. Saved reports open for 30 days.</p>
        </>
      )}
    </Drawer>
  );
}

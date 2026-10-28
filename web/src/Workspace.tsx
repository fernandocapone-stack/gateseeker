import { AppShell, Avatar, Button, Logo, Menu, Skeleton, menuItemClass, navItemClass } from "@gateseeker/ui-kit";
import { Bell, BookOpen, ChevronUp, LayoutDashboard, ListChecks, LogOut, ScanSearch, Settings } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { useAuth } from "./auth-context";
import { NotificationsPanel } from "./components/NotificationsPanel";
import { useLastReportId } from "./last-report";
import { useNotifications } from "./notifications";
import { Link, navigate } from "./router";

/**
 * The signed-in workspace frame (Figma "Analyze Repository" and "Issues"):
 * header with the logo, the page title and the notifications bell, sidebar
 * with the workspace sections and the account menu (Settings, Sign out) at
 * the bottom. "Issues"
 * opens the last report saved in this tab and stays disabled until there is
 * one. The design-system catalogue is product documentation: it uses the
 * frame but has no entry in the sidebar (open /app/design-system directly).
 * While the session is being read (`loading`), the frame renders with
 * skeletons so the page does not jump when it arrives.
 */

export type WorkspacePage = "analyze" | "issues" | "dashboard" | "resources" | "settings" | "design-system";

const TITLE: Record<WorkspacePage, string> = { analyze: "Analyze repository", issues: "Issues", dashboard: "Dashboard", resources: "Resources", settings: "Settings", "design-system": "Design system" };

export function initialsOf(login: string): string {
  return login.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
}

export function Workspace({ page, loading = false, children }: { page: WorkspacePage; loading?: boolean; children: ReactNode }) {
  const auth = useAuth();
  const lastReport = useLastReportId();
  const login = auth.session?.user.login ?? "";
  const notifications = useNotifications(auth.session?.user.id ?? null);
  const [panel, setPanel] = useState(false);
  const closePanel = useCallback(() => { setPanel(false); }, []);

  const account = loading ? (
    <div className="flex items-center gap-2.5 px-4 py-2" aria-hidden="true">
      <Skeleton className="size-8 rounded-full" />
      <Skeleton className="h-3.5 w-24" />
    </div>
  ) : (
    <Menu
      align="start"
      trigger={({ open, toggle, id }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Avatar initials={initialsOf(login)} />
          <span className="min-w-0 flex-1 truncate text-body font-medium tracking-[-0.04em]">{login ? `@${login}` : "Account"}</span>
          <ChevronUp className={`size-3.5 text-primary transition-transform ${open ? "" : "rotate-180"}`} aria-hidden="true" />
        </button>
      )}
    >
      <Link role="menuitem" href="/app/settings" className={menuItemClass}>
        <Settings aria-hidden="true" /> Settings
      </Link>
      <button role="menuitem" type="button" className={menuItemClass} onClick={() => { void auth.signOut().then(() => { navigate("/"); }); }}>
        <LogOut aria-hidden="true" /> Sign out
      </button>
    </Menu>
  );

  const nav = (
    <>
      <Link href="/app/dashboard" aria-current={page === "dashboard" ? "page" : undefined} className={navItemClass(page === "dashboard")}>
        <LayoutDashboard aria-hidden="true" /> Dashboard
      </Link>
      <Link href="/app" aria-current={page === "analyze" ? "page" : undefined} className={navItemClass(page === "analyze")}>
        <ScanSearch aria-hidden="true" /> Analyze repository
      </Link>
      {lastReport ? (
        <Link href={`/r/${lastReport}`} aria-current={page === "issues" ? "page" : undefined} className={navItemClass(page === "issues")}>
          <ListChecks aria-hidden="true" /> Issues
        </Link>
      ) : (
        <span aria-disabled="true" title="Analyze a repository first" className={navItemClass(page === "issues")}>
          <ListChecks aria-hidden="true" /> Issues
        </span>
      )}
      <Link href="/app/resources" aria-current={page === "resources" ? "page" : undefined} className={navItemClass(page === "resources")}>
        <BookOpen aria-hidden="true" /> Resources
      </Link>
    </>
  );

  const unread = notifications.unread;
  const actions = loading ? (
    <Skeleton className="size-8" />
  ) : (
    <Button variant="outline" size="icon" className="relative" aria-label={unread > 0 ? `Notifications, ${String(unread)} unread` : "Notifications"} aria-haspopup="dialog" onClick={() => { setPanel(true); }}>
      <Bell className="text-primary" aria-hidden="true" />
      {unread > 0 && <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-button-stroke bg-destructive px-1 text-micro font-medium text-destructive-foreground not-italic" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
    </Button>
  );

  return (
    <AppShell brand={<Link href="/app/dashboard" aria-label="GateSeeker workspace" className="flex items-center"><Logo label="GateSeeker" /></Link>} title={TITLE[page]} actions={actions} nav={nav} account={account}>
      {children}
      <NotificationsPanel open={panel} onClose={closePanel} items={notifications.items} onMarkAllRead={notifications.markAllRead} />
    </AppShell>
  );
}

import { AppShell, Avatar, Logo, Menu, menuItemClass, navItemClass } from "@gateseeker/ui-kit";
import { ChevronUp, House, ListChecks, LogOut, Palette, ScanSearch } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "./auth-context";
import { useLastReportId } from "./last-report";
import { Link, navigate } from "./router";

/**
 * The signed-in workspace frame (Figma "Analyze Repository" and "Issues"):
 * header with the logo and the page title, sidebar with the workspace
 * sections and the account menu at the bottom. "Issues" opens the last report
 * saved in this tab and stays disabled until there is one.
 */

export type WorkspacePage = "analyze" | "issues" | "design-system";

const TITLE: Record<WorkspacePage, string> = { analyze: "Analyze repository", issues: "Issues", "design-system": "Design system" };

export function Workspace({ page, children }: { page: WorkspacePage; children: ReactNode }) {
  const auth = useAuth();
  const lastReport = useLastReportId();
  const login = auth.session?.user.login ?? "";
  const initials = login.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";

  const account = (
    <Menu
      trigger={({ open, toggle, id }) => (
        <button type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Avatar initials={initials} />
          <span className="min-w-0 flex-1 truncate text-body font-medium tracking-[-0.04em]">{login ? `@${login}` : "Account"}</span>
          <ChevronUp className={`size-3.5 text-primary transition-transform ${open ? "" : "rotate-180"}`} aria-hidden="true" />
        </button>
      )}
    >
      <Link role="menuitem" href="/" className={menuItemClass}>
        <House aria-hidden="true" /> Home page
      </Link>
      <button role="menuitem" type="button" className={menuItemClass} onClick={() => { void auth.signOut().then(() => { navigate("/"); }); }}>
        <LogOut aria-hidden="true" /> Sign out
      </button>
    </Menu>
  );

  const nav = (
    <>
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
      <Link href="/app/design-system" aria-current={page === "design-system" ? "page" : undefined} className={navItemClass(page === "design-system")}>
        <Palette aria-hidden="true" /> Design system
      </Link>
    </>
  );

  return (
    <AppShell brand={<Link href="/app" aria-label="GateSeeker workspace"><Logo label="GateSeeker" /></Link>} title={TITLE[page]} nav={nav} account={account}>
      {children}
    </AppShell>
  );
}

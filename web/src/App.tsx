import { buttonVariants, cn, Logo } from "@gateseeker/ui-kit";
import { LogOut, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { AuthProvider, useAuth } from "./auth-context";
import { PageSkeleton, ReportSkeleton } from "./components/Skeletons";

import { About } from "./pages/About";
import { AppDemo } from "./pages/AppDemo";
import { Dashboard } from "./pages/Dashboard";
import { DesignSystem } from "./pages/DesignSystem";
import { GetStarted } from "./pages/GetStarted";
import { Home } from "./pages/Home";
import { HowItWorks } from "./pages/HowItWorks";
import { Login } from "./pages/Login";
import { Resources, WorkspaceResources } from "./pages/Resources";
import { SavedReport } from "./pages/SavedReport";
import { SettingsPage } from "./pages/Settings";
import { Link, Router, navigate, usePath } from "./router";
import { Workspace, type WorkspacePage } from "./Workspace";

/**
 * Site shell: sticky header with the sections the PO asked for (Home, How it
 * works, About, Resources), "Log in" and the "Get started" call to action, the
 * routed page, and a three-column footer. The demo workspace (/app) is
 * provisional and unguarded until accounts exist.
 */

const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
  { href: "/resources", label: "Resources" },
];

const TITLES: Record<string, string> = {
  "/": "Gateseeker",
  "/how-it-works": "How it works · Gateseeker",
  "/about": "About · Gateseeker",
  "/resources": "Resources · Gateseeker",
  "/get-started": "Get started · Gateseeker",
  "/login": "Log in · Gateseeker",
  "/app": "Analyze a repository · Gateseeker",
  "/app/design-system": "Design system · Gateseeker",
  "/app/settings": "Settings · Gateseeker",
  "/app/dashboard": "Dashboard · Gateseeker",
  "/app/resources": "Resources · Gateseeker",
};

/* The public site exists only for signed-out visitors; a session sends these to the workspace. /login forwards on its own. */
const PUBLIC_ROUTES = new Set(["/", "/how-it-works", "/about", "/get-started"]);
/* Public pages with a workspace counterpart forward there instead of the Dashboard. */
const WORKSPACE_COUNTERPART: Record<string, string> = { "/resources": "/app/resources" };
const WORKSPACE_HOME = "/app/dashboard";

const REPORT_ROUTE = /^\/r\/([A-Za-z0-9-]{1,64})$/;

export function App() {
  return (
    <Router>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </Router>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="GateSeeker home" className={cn("flex items-center", className)}>
      <Logo label="GateSeeker" />
    </Link>
  );
}

function Shell() {
  const path = usePath();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const reportId = REPORT_ROUTE.exec(path)?.[1] ?? null;
  useEffect(() => {
    document.title = TITLES[path] ?? (reportId ? "Saved report · Gateseeker" : "Gateseeker");
    setOpen(false);
  }, [path, reportId]);
  useEffect(() => {
    if (auth.status === "signed-out" && path === "/app/resources") navigate("/resources", { replace: true });
    if (auth.status !== "signed-in") return;
    if (PUBLIC_ROUTES.has(path)) navigate(WORKSPACE_HOME, { replace: true });
    else if (WORKSPACE_COUNTERPART[path]) navigate(WORKSPACE_COUNTERPART[path], { replace: true });
  }, [auth.status, path]);

  let page = <NotFound />;
  if (path === "/") page = <Home />;
  else if (path === "/how-it-works") page = <HowItWorks />;
  else if (path === "/about") page = <About />;
  else if (path === "/resources") page = <Resources />;
  else if (path === "/get-started") page = <GetStarted />;
  else if (path === "/login") page = <Login />;
  else if (path === "/app") page = <AppDemo />;
  else if (path === "/app/design-system") page = <DesignSystem />;
  else if (path === "/app/settings") page = <SettingsPage />;
  else if (path === "/app/dashboard") page = <Dashboard />;
  else if (path === "/app/resources") page = <WorkspaceResources />;
  else if (reportId) page = <SavedReport id={reportId} />;

  const signedIn = auth.status === "signed-in" && auth.session !== null;
  // Signed in, the workspace pages get the application frame instead of the site header and footer.
  const workspacePage: WorkspacePage | null = path === "/app" ? "analyze" : path === "/app/design-system" ? "design-system" : path === "/app/settings" ? "settings" : path === "/app/dashboard" ? "dashboard" : path === "/app/resources" ? "resources" : reportId ? "issues" : null;
  if (signedIn && workspacePage) return <Workspace page={workspacePage}>{page}</Workspace>;
  // A public page must not flash for a signed-in visitor: render nothing until the session is known, then redirect (effect above).
  if ((PUBLIC_ROUTES.has(path) || path in WORKSPACE_COUNTERPART) && (auth.status === "loading" || signedIn)) return <div className="min-h-dvh bg-background" />;
  // While the session is read, workspace pages already show the frame with skeletons.
  if (auth.status === "loading" && workspacePage) {
    return (
      <Workspace page={workspacePage} loading>
        {workspacePage === "issues" ? <ReportSkeleton label="Loading the saved report" /> : <PageSkeleton label="Checking your session" />}
      </Workspace>
    );
  }
  const login = auth.session?.user.login;
  const accountLabel = login ? `@${login}` : "Workspace";

  const navLink = (href: string) =>
    cn("rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent/60 hover:text-foreground", path === href ? "bg-accent/60 text-foreground" : "text-muted-foreground");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-sidebar">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <nav aria-label="Main" className="hidden items-center gap-1 text-sm sm:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined} className={navLink(n.href)}>
                {n.label}
              </Link>
            ))}
            {signedIn ? (
              <>
                <Link href="/app" aria-current={path === "/app" ? "page" : undefined} className={navLink("/app")}>
                  {accountLabel}
                </Link>
                <button type="button" className={cn(navLink("/sign-out"), "inline-flex items-center gap-1.5")} onClick={() => void auth.signOut()}>
                  <LogOut className="size-3.5" aria-hidden="true" /> Sign out
                </button>
              </>
            ) : (
              <Link href="/login" aria-current={path === "/login" ? "page" : undefined} className={navLink("/login")}>
                Log in
              </Link>
            )}
            <Link href="/get-started" className={cn(buttonVariants({ size: "sm" }), "ml-2")}>
              Get started
            </Link>
          </nav>
          <button type="button" className="rounded-md p-1.5 hover:bg-accent/60 sm:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => { setOpen((o) => !o); }}>
            {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
        {open && (
          <nav aria-label="Main (mobile)" className="border-t bg-background px-4 py-3 sm:hidden">
            <ul className="grid gap-1 text-sm">
              {[...NAV, signedIn ? { href: "/app", label: accountLabel } : { href: "/login", label: "Log in" }].map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className={cn("block rounded-md px-2.5 py-2", path === n.href ? "bg-accent/60 text-foreground" : "text-muted-foreground")}>
                    {n.label}
                  </Link>
                </li>
              ))}
              {signedIn && (
                <li>
                  <button type="button" className="block w-full rounded-md px-2.5 py-2 text-left text-muted-foreground" onClick={() => void auth.signOut()}>
                    Sign out
                  </button>
                </li>
              )}
              <li className="pt-2">
                <Link href="/get-started" className={cn(buttonVariants({ size: "default" }), "w-full")}>
                  Get started
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">{page}</main>

      <footer className="border-t bg-card/40">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 text-sm sm:grid-cols-[1.6fr_1fr_1fr] sm:px-6">
          <div className="grid content-start gap-3">
            <Brand />
            <p className="max-w-sm text-muted-foreground">Security gate for AI-generated code. Reads your repository, never runs it, and tells you which findings matter and why.</p>
          </div>
          <FooterColumn title="Product" links={[{ href: "/how-it-works", label: "How it works" }, { href: "/get-started", label: "Get started" }, { href: "/resources", label: "Rules and limits" }, { href: "/login", label: "Log in" }]} />
          <FooterColumn title="Project" links={[{ href: "/about", label: "About" }, { href: "https://github.com/gateseeker-dev/gateseeker", label: "GitHub" }, { href: "https://www.npmjs.com/package/gateseeker", label: "npm" }, { href: "https://github.com/gateseeker-dev/gateseeker/blob/main/SECURITY.md", label: "Security policy" }]} />
        </div>
        <div className="border-t">
          <p className="mx-auto max-w-5xl px-4 py-4 text-xs text-muted-foreground sm:px-6">
            Open source, MIT. "No known vulnerabilities" means none was returned by the sources consulted at query time, not that a project is secure.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h2>
      <ul className="grid gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="text-foreground/80 hover:text-foreground">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotFound() {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted-foreground">
        Nothing lives at this address. <Link href="/" className="text-primary hover:underline">Back to the start</Link>.
      </p>
    </section>
  );
}

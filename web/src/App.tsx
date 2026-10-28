import { cn } from "@gateseeker/ui-kit";
import { Menu, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { About } from "./pages/About";
import { AppDemo } from "./pages/AppDemo";
import { GetStarted } from "./pages/GetStarted";
import { Home } from "./pages/Home";
import { HowItWorks } from "./pages/HowItWorks";
import { Login } from "./pages/Login";
import { Resources } from "./pages/Resources";
import { Link, Router, usePath } from "./router";

/**
 * Site shell: header with the five sections the PO asked for (Home, About,
 * How it works, Resources, Get started), the routed page, and the footer.
 * "Log in" leads to the sign-in shell (/login); the demo workspace (/app) is
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
};

export function App() {
  return (
    <Router>
      <Shell />
    </Router>
  );
}

function Shell() {
  const path = usePath();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.title = TITLES[path] ?? "Gateseeker";
    setOpen(false);
  }, [path]);

  let page = <NotFound />;
  if (path === "/") page = <Home />;
  else if (path === "/how-it-works") page = <HowItWorks />;
  else if (path === "/about") page = <About />;
  else if (path === "/resources") page = <Resources />;
  else if (path === "/get-started") page = <GetStarted />;
  else if (path === "/login") page = <Login />;
  else if (path === "/app") page = <AppDemo />;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
            Gateseeker
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 text-sm sm:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined} className={cn("hover:text-foreground", path === n.href ? "text-foreground" : "text-muted-foreground")}>
                {n.label}
              </Link>
            ))}
            <Link href="/login" aria-current={path === "/login" ? "page" : undefined} className={cn("hover:text-foreground", path === "/login" ? "text-foreground" : "text-muted-foreground")}>
              Log in
            </Link>
            <Link href="/get-started" className="inline-flex h-8 items-center rounded-md border border-primary-stroke bg-primary px-3 text-xs font-medium text-primary-foreground shadow-solid [--shadow-color:var(--primary-stroke)] hover:bg-primary-hover">
              Get started
            </Link>
          </nav>
          <button type="button" className="sm:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => { setOpen((o) => !o); }}>
            {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
        {open && (
          <nav aria-label="Main (mobile)" className="border-t px-4 py-3 sm:hidden">
            <ul className="grid gap-2 text-sm">
              {[...NAV, { href: "/login", label: "Log in" }, { href: "/get-started", label: "Get started" }].map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className={cn("block py-1", path === n.href ? "text-foreground" : "text-muted-foreground")}>
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{page}</main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>Gateseeker is open source (MIT). "No known vulnerabilities" means none was returned by the sources consulted at query time, not that a project is secure.</p>
          <ul className="flex gap-4">
            <li><Link href="https://github.com/gateseeker-dev/gateseeker" className="hover:text-foreground">GitHub</Link></li>
            <li><Link href="https://www.npmjs.com/package/gateseeker" className="hover:text-foreground">npm</Link></li>
            <li><Link href="https://github.com/gateseeker-dev/gateseeker/blob/main/SECURITY.md" className="hover:text-foreground">Security</Link></li>
          </ul>
        </div>
      </footer>
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

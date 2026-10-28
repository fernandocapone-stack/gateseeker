import { buttonVariants, cn } from "@gateseeker/ui-kit";
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
};

export function App() {
  return (
    <Router>
      <Shell />
    </Router>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5 text-base font-semibold tracking-tight", className)}>
      <span className="flex size-7 items-center justify-center rounded-md border border-primary/40 bg-primary/15 text-primary">
        <ShieldCheck className="size-4" aria-hidden="true" />
      </span>
      Gateseeker
    </Link>
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

  const navLink = (href: string) =>
    cn("rounded-md px-2.5 py-1.5 transition-colors hover:bg-accent/60 hover:text-foreground", path === href ? "bg-accent/60 text-foreground" : "text-muted-foreground");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <nav aria-label="Main" className="hidden items-center gap-1 text-sm sm:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined} className={navLink(n.href)}>
                {n.label}
              </Link>
            ))}
            <Link href="/login" aria-current={path === "/login" ? "page" : undefined} className={navLink("/login")}>
              Log in
            </Link>
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
              {[...NAV, { href: "/login", label: "Log in" }].map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className={cn("block rounded-md px-2.5 py-2", path === n.href ? "bg-accent/60 text-foreground" : "text-muted-foreground")}>
                    {n.label}
                  </Link>
                </li>
              ))}
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

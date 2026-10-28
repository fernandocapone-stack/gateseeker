import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

/**
 * A minimal path router (no dependency): reads window.location.pathname,
 * updates it with pushState on <Link> clicks, and re-renders on popstate.
 * The server (vercel.json rewrites / local-server fallback) serves index.html
 * for every non-API path, so deep links work.
 */

const RouteContext = createContext<string>("/");

function normalize(path: string): string {
  const p = path.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(() => normalize(window.location.pathname));
  useEffect(() => {
    const onPop = () => { setPath(normalize(window.location.pathname)); };
    window.addEventListener("popstate", onPop);
    window.addEventListener("gateseeker:navigate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("gateseeker:navigate", onPop);
    };
  }, []);
  return <RouteContext.Provider value={path}>{children}</RouteContext.Provider>;
}

export function usePath(): string {
  return useContext(RouteContext);
}

/** `replace` swaps the current history entry, for redirects the back button must not return to. */
export function navigate(to: string, { replace = false }: { replace?: boolean } = {}): void {
  if (normalize(window.location.pathname) === normalize(to)) return;
  if (replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  window.dispatchEvent(new Event("gateseeker:navigate"));
  window.scrollTo({ top: 0 });
}

export function Link({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const internal = href.startsWith("/") && !href.startsWith("//");
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (!internal || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...(internal ? {} : { rel: "noreferrer noopener" })} {...props} />;
}

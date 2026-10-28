import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { cn } from "./utils";

/*
 * Application frame from the Figma file (1280 x 900 screens): a 51px header
 * split into a 236px brand cell and the page title bar, a 236px sidebar with
 * the navigation on top and the account at the bottom, and the content on the
 * page colour with 16px padding. Every stroke is --border (Color-stroke).
 * Header and sidebar are fixed to the viewport: only the content scrolls, so
 * the account stays at the bottom of the window however long the page is.
 */
export function AppShell({ brand, title, actions, nav, account, children }: { brand: ReactNode; title: ReactNode; actions?: ReactNode; nav: ReactNode; account?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 grid-rows-[51px_1fr] bg-background md:grid-cols-[236px_1fr] print:block print:min-h-0">
      <div className="sticky top-0 z-30 hidden items-center border-r border-b bg-sidebar px-4 md:flex print:hidden">{brand}</div>
      <header className="sticky top-0 z-30 flex items-center gap-1.5 border-b bg-sidebar px-4 py-2 print:hidden">
        <div className="mr-2 md:hidden">{brand}</div>
        <p className="min-w-0 flex-1 truncate text-title font-medium">{title}</p>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </header>
      <aside className="sticky top-[51px] z-20 hidden h-[calc(100dvh-51px)] flex-col justify-between self-start border-r bg-sidebar md:flex print:hidden">
        <nav aria-label="Workspace" className="flex min-h-0 flex-col overflow-y-auto py-4">{nav}</nav>
        {account}
      </aside>
      <main className="min-w-0 p-4 print:p-0">
        <nav aria-label="Workspace (mobile)" className="-mx-4 -mt-4 mb-4 flex overflow-x-auto border-b bg-sidebar md:hidden print:hidden [&>*]:shrink-0 [&>*]:whitespace-nowrap">{nav}</nav>
        {children}
      </main>
    </div>
  );
}

/* Sidebar item: 40px tall, 16px icon, 13px medium label; the active one is white with a 2px blue bar on the right. */
export function navItemClass(active: boolean): string {
  return cn(
    "flex h-10 items-center gap-2 border-r-2 px-4 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0",
    active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
    "aria-disabled:pointer-events-none aria-disabled:opacity-50",
  );
}

/* Round avatar with initials on the chip fill (32px, 12px semibold). */
export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-chip text-label font-semibold text-foreground", className)} aria-hidden="true">
      {initials}
    </span>
  );
}

/*
 * Dropdown menu (Figma "dropdown"): 204px wide panel on the card surface,
 * 42px rows with a 16px icon, a 1px divider between rows. Opens upwards from
 * the account button at the bottom of the sidebar. Escape and outside clicks
 * close it.
 */
export function Menu({ trigger, children, placement = "top", className }: { trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode; children: ReactNode; placement?: "top" | "bottom"; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className={cn("relative", className)}>
      {trigger({ open, toggle: () => { setOpen((o) => !o); }, id })}
      {open && (
        <div id={id} role="menu" className={cn("absolute right-2 z-50 w-[204px] overflow-hidden rounded-lg border bg-popover shadow-solid", placement === "top" ? "bottom-full mb-1" : "top-full mt-1")} onClick={() => { setOpen(false); }}>
          {children}
        </div>
      )}
    </div>
  );
}

export const menuItemClass =
  "flex h-[42px] w-full items-center gap-2 border-b px-[17px] text-left text-body font-medium text-foreground last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none [&_svg]:size-4 [&_svg]:text-muted-foreground";

/*
 * Side panel (Figma "Notifications"): 436px wide, header with the title and a
 * 32px close button, content on the sidebar surface. Rendered as a modal
 * dialog over the page.
 */
export function Drawer({ open, title, onClose, closeLabel = "Close", children }: { open: boolean; title: string; onClose: () => void; closeLabel?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label={title} className="flex h-full w-full max-w-[436px] flex-col border-l bg-sidebar" onClick={(e) => { e.stopPropagation(); }}>
        <div className="flex h-[51px] items-center justify-between border-b pr-[17px] pl-[17px]">
          <h2 className="text-title font-medium">{title}</h2>
          <button type="button" onClick={onClose} aria-label={closeLabel} className="flex size-8 items-center justify-center rounded-md border border-button-stroke bg-button text-primary shadow-solid hover:bg-button-hover [&_svg]:size-3">
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M1 1l8 8M9 1l-8 8" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-[13px] pt-4">{children}</div>
      </section>
    </div>
  );
}

/*
 * Data table (Figma "table" inside the Issues card): rows separated by the
 * stroke, a 40px header row with 13px secondary labels, body rows with 16px
 * vertical padding. The wrapper is a bordered card with 8px radius.
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-sidebar print:overflow-visible">
      <table className={cn("w-full border-collapse text-left", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-10 border-b px-2 text-body font-medium whitespace-nowrap text-muted-foreground first:pl-3 last:pr-6", className)} {...props} />;
}
export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-2 py-4 align-middle first:pl-3 last:pr-6", className)} {...props} />;
}

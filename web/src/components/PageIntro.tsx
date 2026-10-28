import type { ReactNode } from "react";

/** Title block shared by the inner pages: optional eyebrow, h1, one-paragraph lead. */
export function PageIntro({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative mb-12">
      <div className="hero-glow pointer-events-none absolute -inset-x-6 -top-14 h-64 sm:-top-20 sm:h-72" aria-hidden="true" />
      <div className="relative">
        {eyebrow && <p className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {lead && <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

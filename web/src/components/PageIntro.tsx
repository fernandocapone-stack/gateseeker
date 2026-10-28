import type { ReactNode } from "react";

/** Title block shared by the inner pages: optional eyebrow, h1, one-paragraph lead. */
export function PageIntro({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative mb-12">
      <div className="relative">
        {eyebrow && <p className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {lead && <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

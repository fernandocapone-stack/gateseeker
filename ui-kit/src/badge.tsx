import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "./utils";

/*
 * Badges from the Figma file. Severity: 16px tall, 4px radius, 1px outline and
 * text in the severity colour, italic uppercase at 9px (the "micro" size; the
 * PO kept it for fidelity, review point). Kind ("Code pattern"): same shape
 * on the recessed chip fill. Pill: the KPI note, 11px italic on the chip fill.
 * The older solid variants stay for the triage interface.
 */
const badgeVariants = cva("inline-flex shrink-0 items-center whitespace-nowrap", {
  variants: {
    variant: {
      critical: "h-4 rounded-sm border border-severity-critical px-1.5 text-micro uppercase italic text-severity-critical",
      high: "h-4 rounded-sm border border-severity-high px-1.5 text-micro uppercase italic text-severity-high",
      moderate: "h-4 rounded-sm border border-severity-moderate px-1.5 text-micro uppercase italic text-severity-moderate",
      low: "h-4 rounded-sm border border-severity-low px-1.5 text-micro uppercase italic text-severity-low",
      kind: "h-4 rounded-sm bg-chip px-1.5 text-micro uppercase italic text-chip-foreground",
      pill: "rounded-full bg-chip px-2 py-0.5 text-caption italic text-chip-foreground",
      default: "rounded-sm border border-primary bg-primary px-2 py-0.5 text-label font-medium text-primary-foreground",
      secondary: "rounded-sm border border-border bg-secondary px-2 py-0.5 text-label font-medium text-secondary-foreground",
      outline: "rounded-sm border border-border-strong px-2 py-0.5 font-mono text-label tracking-tight text-foreground",
      success: "rounded-sm border border-success bg-success px-2 py-0.5 text-label font-medium text-success-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

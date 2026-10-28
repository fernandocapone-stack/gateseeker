import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "./utils";

/*
 * Severity badges use solid fills with a foreground token chosen per colour so
 * the label stays readable on the dark background. Neutral badges use a tinted
 * fill plus a border instead of a flat grey block.
 */
const badgeVariants = cva("inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap leading-5", {
  variants: {
    variant: {
      default: "border-primary bg-primary text-primary-foreground",
      secondary: "border-border bg-secondary text-secondary-foreground",
      outline: "border-border-strong bg-transparent text-foreground font-mono tracking-tight",
      critical: "border-destructive bg-destructive text-destructive-foreground",
      high: "border-severity-high bg-severity-high text-severity-high-foreground",
      moderate: "border-warning bg-warning text-warning-foreground",
      low: "border-border-strong bg-muted text-foreground",
      success: "border-success bg-success text-success-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

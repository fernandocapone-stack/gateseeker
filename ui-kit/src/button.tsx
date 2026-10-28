import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

/*
 * Buttons from the Figma file: 6px radius, a 1px stroke in --button-stroke and
 * a solid 2px drop shadow (no blur) in the same colour. On press the button
 * moves down by the shadow offset and the shadow collapses. Each variant sets
 * --shadow-color to its stroke; the offset lives in theme.css.
 * Sizes: default 38px (Analyze), sm 32px (header and toolbar), md 33px (View issue), icon 32px.
 */
const solid =
  "border shadow-solid active:translate-y-[var(--shadow-offset)] active:shadow-none disabled:shadow-none";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[background-color,color,box-shadow,transform] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: cn(solid, "border-primary-stroke bg-primary text-primary-foreground [--shadow-color:var(--primary-stroke)] hover:bg-primary-hover"),
        destructive: cn(solid, "border-destructive-stroke bg-destructive text-destructive-foreground [--shadow-color:var(--destructive-stroke)] hover:brightness-110"),
        success: cn(solid, "border-success-stroke bg-success text-success-foreground [--shadow-color:var(--success-stroke)] hover:brightness-110"),
        outline: cn(solid, "border-button-stroke bg-button text-foreground [--shadow-color:var(--button-stroke)] hover:bg-button-hover"),
        secondary: cn(solid, "border-button-stroke bg-secondary text-secondary-foreground [--shadow-color:var(--button-stroke)] hover:bg-accent"),
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[38px] px-4 text-body",
        sm: "h-8 px-3 text-body",
        md: "h-[33px] px-4 text-label",
        lg: "h-10 px-5 text-body",
        icon: "size-8 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/*
 * Segmented control (the All / Open / Approved / Resolved filter): buttons
 * joined edge to edge, the selected one on the sidebar surface with white
 * text, the others on the page colour with secondary text.
 */
export function Segmented<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex h-8 items-stretch", className)}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => { onChange(o.value); }}
            className={cn(
              "border-y border-r border-button-stroke px-3 text-label font-medium shadow-solid transition-colors focus-visible:relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              i === 0 && "rounded-l-md border-l",
              i === options.length - 1 && "rounded-r-md",
              selected ? "bg-sidebar text-foreground [--shadow-color:#14121d]" : "bg-button text-muted-foreground hover:bg-button-hover hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

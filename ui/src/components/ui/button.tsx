import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/*
 * Buttons carry a visible 1px stroke and a solid offset shadow (no blur).
 * On press the button moves by the shadow offset and the shadow collapses,
 * which reads as a physical click. Shadow size and colour come from the
 * --shadow-* tokens in index.css.
 */
const solid =
  "border shadow-solid active:translate-x-[var(--shadow-offset)] active:translate-y-[var(--shadow-offset)] active:shadow-none disabled:shadow-none";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: cn(solid, "border-primary bg-primary text-primary-foreground hover:bg-primary-hover"),
        destructive: cn(solid, "border-destructive bg-destructive text-destructive-foreground hover:brightness-110"),
        success: cn(solid, "border-success bg-success text-success-foreground hover:brightness-110"),
        outline: cn(solid, "border-border-strong bg-card text-foreground hover:bg-accent hover:text-accent-foreground"),
        secondary: cn(solid, "border-border-strong bg-secondary text-secondary-foreground hover:bg-accent"),
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./utils";

/* Controls from the Figma file: sidebar surface, 1px dark stroke, 6px radius, 13px text, no inner shadow. */
const control =
  "flex w-full rounded-md border border-input-border bg-input px-3 py-2 text-body text-foreground transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-10", className)} {...props} />;
}

/** An input with a leading 20px icon inside the field (the repository URL field). */
export function IconInput({ icon, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode }) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <span className="pointer-events-none absolute left-[13px] flex size-5 items-center justify-center text-primary [&_svg]:size-5" aria-hidden="true">
        {icon}
      </span>
      <input className={cn(control, "h-10 pl-[41px]")} {...props} />
    </div>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-20", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-10", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-body font-medium leading-none", className)} {...props} />;
}

/** A labelled control with a one-sentence help text, the building block of the review form. */
export function Field({ label, help, htmlFor, children, draft }: { label: string; help?: string; htmlFor?: string; children: ReactNode; draft?: boolean }) {
  return (
    <div className={cn("grid gap-1.5 rounded-md", draft && "border border-warning/60 bg-warning/10 p-2")}>
      <div className="flex items-center gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {draft && <span className="text-label text-warning">rascunho, confirme</span>}
      </div>
      {children}
      {help && <p className="text-label text-muted-foreground">{help}</p>}
    </div>
  );
}

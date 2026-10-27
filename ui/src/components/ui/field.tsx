import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/* Controls sit slightly below the surface: darker fill, 1px stroke and a solid (no blur) inner top shadow. */
const control =
  "flex w-full rounded-md border border-input-border bg-input px-3 py-2 text-sm text-foreground inset-shadow-solid transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 hover:border-border-strong focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-20", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-9", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

/** A labelled control with a one-sentence help text, the building block of the review form. */
export function Field({ label, help, htmlFor, children, draft }: { label: string; help?: string; htmlFor?: string; children: ReactNode; draft?: boolean }) {
  return (
    <div className={cn("grid gap-1.5 rounded-md", draft && "border border-warning/60 bg-warning/10 p-2")}>
      <div className="flex items-center gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {draft && <span className="text-xs text-warning">rascunho, confirme</span>}
      </div>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

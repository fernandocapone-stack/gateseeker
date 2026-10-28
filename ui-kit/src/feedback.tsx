import type { HTMLAttributes } from "react";
import { cn } from "./utils";

/*
 * Skeleton: a block in the chip colour with a slow pulse, shaped like the
 * content it stands for. Screen readers get one status message from the
 * caller instead of a list of empty boxes, so skeletons are aria-hidden.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-chip motion-reduce:animate-none", className)} {...props} />;
}

/*
 * Switch (proposal: the Figma file has no toggle yet): 36 x 20 track on the
 * chip fill with the dark stroke, blue when on; a native checkbox underneath
 * keeps keyboard and screen-reader behaviour.
 */
export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start justify-between gap-4", disabled && "cursor-not-allowed opacity-50")}>
      <span className="grid gap-0.5">
        <span className="text-body font-medium">{label}</span>
        {description && <span className="text-label text-muted-foreground">{description}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => { onChange(e.target.checked); }} />
        <span aria-hidden="true" className="h-5 w-9 rounded-full border border-button-stroke bg-chip transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background" />
        <span aria-hidden="true" className="absolute top-[3px] left-[3px] size-3.5 rounded-full bg-muted-foreground transition-transform peer-checked:translate-x-4 peer-checked:bg-primary-foreground" />
      </span>
    </label>
  );
}

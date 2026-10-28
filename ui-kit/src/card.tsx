import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

/* Cards from the Figma file: sidebar surface, 1px stroke, 8px radius, 16px padding, no blurred shadow. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border bg-card text-card-foreground", className)} {...props} />;
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4", className)} {...props} />;
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-title font-medium", className)} {...props} />;
}
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-label text-muted-foreground", className)} {...props} />;
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0", className)} {...props} />;
}
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2 p-4 pt-0", className)} {...props} />;
}

/* KPI card (Figma "MetricCard"): 12px label, 20px value, and an optional italic pill note below. */
export function MetricCard({ label, value, note, className, tone }: { label: ReactNode; value: ReactNode; note?: ReactNode; className?: string; tone?: string }) {
  return (
    <Card className={cn("flex flex-col items-start gap-4 p-4", className)}>
      <div className="flex flex-col">
        <span className="text-label text-muted-foreground">{label}</span>
        <span className={cn("text-metric font-medium tabular-nums", tone)}>{value}</span>
      </div>
      {note !== undefined && <span className="rounded-full bg-chip px-2 py-0.5 text-caption italic text-chip-foreground">{note}</span>}
    </Card>
  );
}

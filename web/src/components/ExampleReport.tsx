import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from "@gateseeker/ui-kit";
import { ShieldAlert } from "lucide-react";

/**
 * A static, illustrative report for the marketing Home. It is not produced by
 * the engine and never changes: the rule ids are real Gateseeker rules, the
 * project, files and counts are invented for the illustration and the block is
 * labelled as an example. The live analysis lives in the demo workspace (/app).
 */

const EXAMPLE = {
  repository: "your-org/your-app",
  counts: { P1: 2, P2: 1, P3: 3, P4: 0 },
  findings: [
    { priority: "P1", severity: "CRITICAL", subject: "src/lib/stripe.ts:4", rule: "GSK-SECRET-001", title: "Live Stripe secret key hardcoded", action: "Move the key to a server-side environment variable and rotate it now." },
    { priority: "P1", severity: "HIGH", subject: "supabase/migrations/0002_orders.sql", rule: "GSK-SUPABASE-001", title: "Table created without row level security", action: "Enable RLS on the orders table and add policies scoped to the signed-in user." },
    { priority: "P2", severity: "HIGH", subject: "next.config.mjs:10", rule: "GSK-CORS-001", title: "CORS allows any origin with credentials", action: "Restrict Access-Control-Allow-Origin to the exact domains that need access." },
  ],
} as const;

const PRIORITY_LABEL: Record<string, string> = { P1: "Fix now", P2: "Fix before release", P3: "Plan a fix", P4: "Keep an eye on it" };

function priorityVariant(p: string): "critical" | "high" | "moderate" | "low" {
  return p === "P1" ? "critical" : p === "P2" ? "high" : p === "P3" ? "moderate" : "low";
}

export function ExampleReport({ className }: { className?: string }) {
  return (
    <figure className={cn("grid gap-3", className)} aria-label="Example report">
      <figcaption className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">Example report.</span> Illustrative, not a live analysis.
        </span>
        <span className="font-mono">{EXAMPLE.repository}</span>
      </figcaption>
      <Card className="border-destructive/60">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <ShieldAlert className="size-6 text-destructive" aria-hidden="true" />
            <span className="text-destructive">FAIL</span>
            <span className="font-mono text-sm font-normal text-muted-foreground">{EXAMPLE.repository}@a1b2c3d</span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">2 findings at priority P1: the gate blocks this merge until they are fixed.</p>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["P1", "P2", "P3", "P4"] as const).map((pr) => (
              <div key={pr} className="rounded-md border bg-background p-3">
                <dt className="text-xs text-muted-foreground">
                  {pr} · {PRIORITY_LABEL[pr]}
                </dt>
                <dd className="text-2xl font-semibold tabular-nums">{EXAMPLE.counts[pr]}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <ol className="grid gap-3">
        {EXAMPLE.findings.map((f) => (
          <li key={f.subject}>
            <Card>
              <div className="flex items-start gap-3 p-4">
                <Badge variant={priorityVariant(f.priority)} className="mt-0.5 shrink-0">{f.priority}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{f.subject}</span>
                    <Badge variant={f.severity === "CRITICAL" ? "critical" : "high"}>{f.severity}</Badge>
                    <Badge variant="outline">code pattern</Badge>
                  </div>
                  <p className="mt-1 text-sm">{f.rule}: {f.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{f.action}</p>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </figure>
  );
}

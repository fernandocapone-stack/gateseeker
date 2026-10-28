import { Card, Skeleton } from "@gateseeker/ui-kit";

/**
 * Loading placeholders shaped like the workspace pages, so the frame does not
 * jump when the content arrives. Each one carries a single status message for
 * screen readers; the boxes themselves are aria-hidden.
 */

export function ReportSkeleton({ label }: { label?: string }) {
  return (
    <div className="grid gap-4" role={label ? "status" : undefined}>
      {label && <span className="sr-only">{label}</span>}
      <Card className="grid gap-3 p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </Card>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="grid gap-3 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-10" />
            <Skeleton className="h-4 w-28 rounded-full" />
          </Card>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-40" />
      </div>
      <Card className="overflow-hidden">
        <div className="h-10 border-b" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b py-4 pr-6 pl-3 last:border-b-0">
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-3 w-56" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-3 w-full max-w-sm" />
            </div>
            <Skeleton className="hidden h-8 w-24 sm:block" />
            <Skeleton className="h-[33px] w-[95px]" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/** The workspace content while the session is being read: the Analyze card outline. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-4" role="status">
      <span className="sr-only">{label}</span>
      <Card className="grid gap-4 bg-transparent p-4">
        <div className="grid gap-2">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-3 w-full max-w-lg" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-[38px] w-[103px]" />
        </div>
        <Skeleton className="h-3 w-full max-w-md" />
      </Card>
    </div>
  );
}

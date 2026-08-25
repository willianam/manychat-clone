import { Skeleton } from "@/components/ui/skeleton";

/** Generic loading state: a header and a few card-shaped rows. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8" aria-busy aria-label="Carregando">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </main>
  );
}

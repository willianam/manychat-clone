import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)]" aria-busy aria-label="Carregando">
      <div className="hidden w-80 space-y-3 border-r p-3 md:block">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-6 h-10 w-2/3" />
        <Skeleton className="ml-auto mt-3 h-10 w-1/2" />
      </div>
    </div>
  );
}

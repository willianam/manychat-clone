import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="flex h-[calc(100vh-3.5rem)] flex-col" aria-busy aria-label="Carregando">
      <div className="flex items-center gap-3 border-b bg-card px-6 py-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="ml-auto h-8 w-32" />
      </div>
      <div className="flex flex-1">
        <Skeleton className="hidden w-64 rounded-none border-r md:block" />
        <div className="flex-1 bg-neutral-50" />
      </div>
    </main>
  );
}

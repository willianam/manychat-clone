import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function SegmentNotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <EmptyState
        icon={SearchX}
        title="Segmento não encontrado"
        description="Ele pode ter sido apagado. A lista mostra os que ainda existem."
        action={
          <Button asChild variant="outline">
            <Link href="/segmentos">Ver segmentos</Link>
          </Button>
        }
      />
    </main>
  );
}

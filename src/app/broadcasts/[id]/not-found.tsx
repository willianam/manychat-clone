import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function BroadcastNotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <EmptyState
        icon={SearchX}
        title="Disparo não encontrado"
        description="Ele pode ter sido excluído. A lista mostra o que ainda existe."
        action={
          <Button asChild variant="outline">
            <Link href="/broadcasts">Ver disparos</Link>
          </Button>
        }
      />
    </main>
  );
}

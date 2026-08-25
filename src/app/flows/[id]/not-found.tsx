import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function FlowNotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <EmptyState
        icon={SearchX}
        title="Fluxo não encontrado"
        description="Ele pode ter sido excluído. A lista de fluxos mostra o que ainda existe."
        action={
          <Button asChild variant="outline">
            <Link href="/flows">Ver fluxos</Link>
          </Button>
        }
      />
    </main>
  );
}

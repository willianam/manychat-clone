import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ContactNotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <EmptyState
        icon={SearchX}
        title="Contato não encontrado"
        description="Ele pode ter sido excluído. A lista mostra quem ainda existe."
        action={
          <Button asChild variant="outline">
            <Link href="/contacts">Ver contatos</Link>
          </Button>
        }
      />
    </main>
  );
}

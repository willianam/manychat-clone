import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <EmptyState
        icon={SearchX}
        title="Página não encontrada"
        description="O endereço não existe ou o item foi excluído."
        action={
          <Button asChild variant="outline">
            <Link href="/">Voltar ao início</Link>
          </Button>
        }
      />
    </main>
  );
}

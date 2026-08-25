"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Shared body for every `error.tsx`: says what broke and offers a retry. */
export function ErrorView({
  error,
  reset,
  title = "Algo deu errado",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <EmptyState
        icon={AlertTriangle}
        title={title}
        description={
          <>
            {error.message || "Erro inesperado ao carregar esta página."}
            {error.digest && (
              <span className="mt-1 block font-mono text-xs text-neutral-400">
                ref. {error.digest}
              </span>
            )}
          </>
        }
        action={<Button onClick={reset}>Tentar de novo</Button>}
      />
    </main>
  );
}

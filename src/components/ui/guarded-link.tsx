"use client";

import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isUnsaved, setUnsaved } from "@/lib/ui/unsaved";

/**
 * A `Link` that asks before leaving unsaved work behind.
 *
 * `beforeunload` covers reloads and closed tabs, but a client-side
 * navigation never fires it — the sidebar would silently throw the edit
 * away. Links that can leave the editor use this instead of `Link`; with
 * nothing unsaved it behaves exactly like one.
 */
export function GuardedLink({ href, onClick, ...rest }: ComponentProps<typeof Link>) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  return (
    <>
      <Link
        href={href}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented || !isUnsaved()) return;
          e.preventDefault();
          setPending(typeof href === "string" ? href : String(href));
        }}
        {...rest}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Sair sem salvar?"
        description="Este fluxo tem alterações que ainda não foram salvas. Elas serão perdidas."
        confirmLabel="Sair sem salvar"
        cancelLabel="Continuar editando"
        destructive
        onConfirm={() => {
          const to = pending;
          setPending(null);
          if (!to) return;
          setUnsaved(false);
          router.push(to);
        }}
      />
    </>
  );
}

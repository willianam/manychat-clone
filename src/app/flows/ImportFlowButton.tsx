"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { importFlow } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * "Importar" — reads a .json off disk and hands the text to the server action.
 *
 * The file is read in the browser rather than posted as multipart because the
 * validation that matters is textual: we want to show the user the exact
 * reason a file was rejected, and a failed import should leave them on the
 * same page with the message, not on an error screen.
 */
export function ImportFlowButton() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const onPick = async (file: File | undefined) => {
    if (!file) return;

    const text = await file.text();
    start(async () => {
      try {
        const res = await importFlow(text);
        if (res.ok) {
          toast.success("Fluxo importado.");
          router.push(`/flows/${res.id}`);
        } else {
          toast.error("Arquivo recusado", { description: res.error });
        }
      } catch (err) {
        toast.error("Não foi possível importar.", {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    });
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          // Reset so picking the same file twice still fires a change event.
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => input.current?.click()}
      >
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
        {pending ? "Importando…" : "Importar"}
      </Button>
    </>
  );
}

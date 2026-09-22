"use client";

import { useState } from "react";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  id: string;
  /** The `queueBroadcast` server action, handed down from the page. */
  action: (formData: FormData) => void | Promise<void>;
  scheduled: boolean;
  /** Window snapshot of this draft's audience, taken on the server. */
  preview: { inWindow: number; total: number; mostlyOutOfWindow: boolean } | null;
};

/**
 * The window filter, the reach line and the queue button, together.
 *
 * They live in one client component because the reach the operator reads has
 * to be the reach the chosen filter produces: "só quem está dentro da janela"
 * sends to `inWindow`, "todos" sends to `total`. The card used to print the
 * unfiltered snapshot next to a select that changed it.
 *
 * Queueing here is the same irreversible action the composer already confirms,
 * so this asks with the same words.
 */
export function QueueBroadcastForm({ id, action, scheduled, preview }: Props) {
  const [window, setWindow] = useState<"in" | "all">("in");
  const reach = preview ? (window === "in" ? preview.inWindow : preview.total) : null;

  return (
    <>
      {preview && (
        <div
          className={`mt-2 text-xs ${
            window === "in" && preview.mostlyOutOfWindow ? "text-amber-800" : "text-neutral-600"
          }`}
        >
          {window === "in" ? (
            <>
              {preview.inWindow} de {preview.total} contatos estão dentro da janela agora e vão
              receber
              {preview.mostlyOutOfWindow && ". A maioria não vai receber"}
            </>
          ) : (
            <>
              {preview.total} contatos entram na fila; {preview.total - preview.inWindow} estão fora
              da janela e vão falhar
            </>
          )}
        </div>
      )}
      <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="window" value={window} />
        <Label htmlFor={`window-${id}`} className="sr-only">
          Filtro da janela
        </Label>
        <Select value={window} onValueChange={(v) => setWindow(v as "in" | "all")}>
          <SelectTrigger id={`window-${id}`} className="h-8 w-72 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="in">Só quem está dentro da janela</SelectItem>
            <SelectItem value="all">Todos (fora da janela vai falhar)</SelectItem>
          </SelectContent>
        </Select>
        <ConfirmSubmitButton
          size="sm"
          title={scheduled ? "Agendar este disparo?" : "Enviar este disparo agora?"}
          description={
            <>
              {reach === null
                ? "O disparo vai para o público selecionado."
                : `O disparo vai para ${reach} contato${reach === 1 ? "" : "s"}.`}{" "}
              {scheduled
                ? "Você ainda pode cancelar antes da hora marcada."
                : "As mensagens saem imediatamente e não há como recolhê-las."}
            </>
          }
          confirmLabel={scheduled ? "Agendar" : "Enfileirar"}
        >
          {scheduled ? "Agendar" : "Enfileirar"}
        </ConfirmSubmitButton>
      </form>
    </>
  );
}

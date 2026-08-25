"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { addNote, deleteNote } from "./actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { withToast } from "@/lib/ui/action-toast";

export type NoteDto = { id: string; text: string; createdAt: string };

/** Owner notes: write one, delete one. They also show on the timeline. */
export function Notes({ contactId, notes }: { contactId: string; notes: NoteDto[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<NoteDto | null>(null);

  return (
    <section aria-labelledby="notes-h" className="rounded-xl border bg-card p-4">
      <h2 id="notes-h" className="text-sm font-semibold">
        Notas
      </h2>
      <form
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = text.trim();
          if (!clean) return;
          start(async () => {
            const ok = await withToast(() => addNote(contactId, clean).then(() => true), {
              success: "Nota salva.",
              error: "Não foi possível salvar a nota.",
            });
            if (ok !== undefined) {
              setText("");
              router.refresh();
            }
          });
        }}
      >
        <Label htmlFor="note-text" className="sr-only">
          Nova nota
        </Label>
        <Textarea
          id="note-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="algo que vale lembrar sobre este contato"
        />
        <Button type="submit" size="sm" disabled={pending || !text.trim()}>
          Salvar nota
        </Button>
      </form>

      <ul className="mt-3 space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap">{n.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(n.createdAt).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground"
              aria-label="Excluir nota"
              disabled={pending}
              onClick={() => setConfirming(n)}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Excluir esta nota?"
        description="Ela some daqui e da linha do tempo. Isso não pode ser desfeito."
        confirmLabel="Excluir"
        destructive
        pending={pending}
        onConfirm={() => {
          const note = confirming;
          if (!note) return;
          start(async () => {
            const ok = await withToast(() => deleteNote(contactId, note.id).then(() => true), {
              success: "Nota apagada.",
              error: "Não foi possível apagar a nota.",
            });
            setConfirming(null);
            if (ok !== undefined) router.refresh();
          });
        }}
      />
    </section>
  );
}

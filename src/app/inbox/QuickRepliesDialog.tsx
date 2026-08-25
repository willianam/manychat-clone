"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { QuickReplyTemplate } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { withToast } from "@/lib/ui/action-toast";
import { createQuickReplyAction, deleteQuickReplyAction } from "./actions";

/** Manage the canned answers the "/" picker offers. */
export function QuickRepliesDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: QuickReplyTemplate[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function create(form: FormData) {
    setPending(true);
    const ok = await withToast(
      async () => {
        await createQuickReplyAction({
          title: String(form.get("title") ?? ""),
          text: String(form.get("text") ?? ""),
          shortcut: String(form.get("shortcut") ?? ""),
        });
        return true;
      },
      { success: "Resposta rápida criada.", error: "Não foi possível criar." },
    );
    setPending(false);
    if (ok) router.refresh();
    return ok;
  }

  async function remove(id: string) {
    const ok = await withToast(
      async () => {
        await deleteQuickReplyAction(id);
        return true;
      },
      { success: "Resposta rápida excluída.", error: "Não foi possível excluir." },
    );
    if (ok) router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Respostas rápidas</DialogTitle>
          <DialogDescription>
            Na caixa de resposta, digite / e o atalho para inserir o texto.
          </DialogDescription>
        </DialogHeader>

        {items.length > 0 && (
          <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
            {items.map((q) => (
              <li key={q.id} className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-medium">/{q.shortcut}</span>
                    <span className="ml-2 text-muted-foreground">{q.title}</span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{q.text}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Excluir /${q.shortcut}`}
                  onClick={() => void remove(q.id)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void create(new FormData(form)).then((ok) => {
              if (ok) form.reset();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="qr-title">Título</Label>
              <Input id="qr-title" name="title" required placeholder="Preço" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="qr-shortcut">Atalho (opcional)</Label>
              <Input id="qr-shortcut" name="shortcut" placeholder="preco" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="qr-text">Texto</Label>
            <Textarea id="qr-text" name="text" required rows={3} placeholder="O valor é…" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Adicionar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

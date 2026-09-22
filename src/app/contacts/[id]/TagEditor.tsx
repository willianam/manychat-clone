"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { addTag, removeTag } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagChip } from "@/components/ui/tag-chip";
import { withToast } from "@/lib/ui/action-toast";
import type { ActionFailure } from "@/lib/ui/action-result";

type Tag = { id: string; name: string; color: string };

/** The contact's tags as chips with a remove button, plus a picker to add one (existing or new). */
export function TagEditor({
  contactId,
  tags,
  allTags,
}: {
  contactId: string;
  tags: Tag[];
  allTags: Tag[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const available = allTags.filter((t) => !tags.some((x) => x.id === t.id));

  const run = (job: () => Promise<void | ActionFailure>, success: string) =>
    start(async () => {
      // `?? true` keeps a failure value intact for withToast to show.
      const ok = await withToast(() => job().then((r) => r ?? true), {
        success,
        error: "Não foi possível alterar as etiquetas.",
      });
      if (ok !== undefined) router.refresh();
    });

  return (
    <section aria-labelledby="tags-h" className="rounded-xl border bg-card p-4">
      <h2 id="tags-h" className="text-sm font-semibold">
        Etiquetas
      </h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags.length === 0 && (
          <span className="text-sm text-muted-foreground">Nenhuma etiqueta.</span>
        )}
        {tags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-0.5">
            <TagChip name={t.name} color={t.color} />
            <button
              type="button"
              aria-label={`Remover etiqueta ${t.name}`}
              disabled={pending}
              onClick={() =>
                run(() => removeTag(contactId, t.name), `Etiqueta "${t.name}" removida.`)
              }
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const clean = name.trim();
          if (!clean) return;
          setName("");
          run(() => addTag(contactId, clean), `Etiqueta "${clean}" adicionada.`);
        }}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="tag-add" className="sr-only">
            Adicionar etiqueta
          </Label>
          <Input
            id="tag-add"
            list="tag-options"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="adicionar etiqueta (nova ou existente)"
            className="h-8"
          />
          <datalist id="tag-options">
            {available.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending || !name.trim()}>
          <Plus aria-hidden />
          Adicionar
        </Button>
      </form>
    </section>
  );
}

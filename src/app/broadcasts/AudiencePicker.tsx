"use client";

import { useEffect, useId, useState, useTransition } from "react";
import type { WindowPreview } from "../../server/broadcast-worker";
import { countAudience } from "./preview-action";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagChip } from "@/components/ui/tag-chip";
import { cn } from "@/lib/ui/cn";

type Tag = { id: string; name: string; color: string };

/**
 * Audience selection with a live "who can I actually reach right now" count.
 *
 * The number that matters is `inWindow`. Instagram's 24h rule means a large
 * contact list is mostly unreachable at any given moment, and the old
 * behaviour only revealed that in the report AFTER the broadcast ran. Here
 * it is visible while composing, and it recounts whenever the filter changes.
 */
export function AudiencePicker({ tags }: { tags: Tag[] }) {
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [window, setWindow] = useState<"all" | "in" | "out">("all");
  const [preview, setPreview] = useState<WindowPreview | null>(null);
  const [pending, start] = useTransition();
  const windowId = useId();

  useEffect(() => {
    start(async () => {
      setPreview(await countAudience(tagIds));
    });
  }, [tagIds]);

  const toggle = (id: string) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  // What the send will actually target, given the window filter.
  const targeted =
    preview === null
      ? null
      : window === "in"
        ? preview.inWindow
        : window === "out"
          ? preview.outOfWindow
          : preview.total;

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium leading-none">Etiquetas (vazio = todos)</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => {
            const on = tagIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(t.id)}
                className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <TagChip name={t.name} color={t.color} selected={on} />
              </button>
            );
          })}
          {tags.length === 0 && (
            <span className="text-xs text-muted-foreground">Nenhuma etiqueta criada.</span>
          )}
        </div>
        {tagIds.map((id) => (
          <input key={id} type="hidden" name="tagIds" value={id} />
        ))}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={windowId}>Janela de 24h</Label>
        {/* The action reads "" as "everyone"; Radix Select cannot hold an empty value. */}
        <input type="hidden" name="window" value={window === "all" ? "" : window} />
        <Select value={window} onValueChange={(v) => setWindow(v as "all" | "in" | "out")}>
          <SelectTrigger id={windowId} className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os contatos</SelectItem>
            <SelectItem value="in">Só quem está dentro da janela</SelectItem>
            <SelectItem value="out">Só quem está fora da janela</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        aria-live="polite"
        aria-busy={pending}
        className={cn(
          "rounded-lg border p-3 text-sm",
          preview?.mostlyOutOfWindow ? "border-amber-300 bg-amber-50" : "bg-neutral-50",
        )}
      >
        {preview === null || pending ? (
          <span className="text-muted-foreground">contando…</span>
        ) : preview.total === 0 ? (
          <span className="text-neutral-600">Nenhum contato com esse filtro.</span>
        ) : (
          <>
            <div className="font-medium">
              {preview.inWindow} de {preview.total} contatos estão dentro da janela agora
            </div>
            {preview.mostlyOutOfWindow && (
              <div className="mt-1 text-amber-900">
                A maioria ({preview.outOfWindow}) está fora da janela de 24h e não vai receber. O
                Instagram recusa mensagens para quem não escreveu nas últimas 24 horas; esses
                contatos entram no relatório como não enviados.
              </div>
            )}
            {window !== "all" && targeted !== null && (
              <div className="mt-1 text-neutral-600">
                Com o filtro escolhido, o disparo vai mirar {targeted} contato
                {targeted === 1 ? "" : "s"}
                {window === "out" && targeted > 0
                  ? ", que provavelmente não vão receber nada."
                  : "."}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

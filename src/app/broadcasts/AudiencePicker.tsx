"use client";

import { useEffect, useState, useTransition } from "react";
import type { WindowPreview } from "../../server/broadcast-worker";
import { countAudience } from "./preview-action";

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
  const [window, setWindow] = useState<"" | "in" | "out">("");
  const [preview, setPreview] = useState<WindowPreview | null>(null);
  const [pending, start] = useTransition();

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
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-neutral-500">Etiquetas (vazio = todos)</label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {tags.map((t) => {
            const on = tagIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                className={`rounded-full px-2.5 py-0.5 text-xs ${on ? "text-white" : "border text-neutral-600"}`}
                style={on ? { backgroundColor: t.color } : undefined}
              >
                {t.name}
              </button>
            );
          })}
          {tags.length === 0 && (
            <span className="text-xs text-neutral-500">Nenhuma etiqueta criada.</span>
          )}
        </div>
        {tagIds.map((id) => (
          <input key={id} type="hidden" name="tagIds" value={id} />
        ))}
      </div>

      <div>
        <label className="block text-xs text-neutral-500">Janela de 24h</label>
        <select
          name="window"
          value={window}
          onChange={(e) => setWindow(e.target.value as "" | "in" | "out")}
          className="mt-1 rounded border px-2 py-1.5 text-sm"
        >
          <option value="">Todos os contatos</option>
          <option value="in">Só quem está dentro da janela</option>
          <option value="out">Só quem está fora da janela</option>
        </select>
      </div>

      <div
        className={`rounded-lg border p-3 text-sm ${
          preview?.mostlyOutOfWindow ? "border-amber-300 bg-amber-50" : "bg-neutral-50"
        }`}
      >
        {preview === null || pending ? (
          <span className="text-neutral-500">contando…</span>
        ) : preview.total === 0 ? (
          <span className="text-neutral-600">Nenhum contato com esse filtro.</span>
        ) : (
          <>
            <div className="font-medium">
              {preview.inWindow} de {preview.total} contatos estão dentro da janela agora
            </div>
            {preview.mostlyOutOfWindow && (
              <div className="mt-1 text-amber-900">
                A maioria ({preview.outOfWindow}) está fora da janela de 24h e não vai
                receber. O Instagram recusa mensagens para quem não escreveu nas últimas
                24 horas — esses contatos entram no relatório como não enviados.
              </div>
            )}
            {window !== "" && targeted !== null && (
              <div className="mt-1 text-neutral-600">
                Com o filtro escolhido, o disparo vai mirar {targeted} contato
                {targeted === 1 ? "" : "s"}
                {window === "out" && targeted > 0
                  ? " — que provavelmente não vão receber nada."
                  : "."}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

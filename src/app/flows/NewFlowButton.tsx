"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MediaPicker } from "../../components/MediaPicker";
import { createFlowWithObjective, type Objective } from "./actions";

/**
 * "New flow" as ManyChat asks it: what is this automation FOR?
 *
 * Naming a flow first and wiring a trigger later is how flows end up existing
 * but never running — the trigger is the step people forget, because nothing
 * in the interface ever asked for it. Asking the objective up front makes the
 * trigger part of creation, not a follow-up.
 *
 * The objective is a small set on purpose. These are the three entry points
 * that actually carry Instagram DM automation, plus the honest fourth for a
 * flow something else will call into.
 */

const OBJECTIVES: Array<{
  key: Objective;
  title: string;
  hint: string;
  icon: string;
}> = [
  {
    key: "comment",
    title: "Comentários na publicação ou Reel",
    hint: "Alguém comenta uma palavra e recebe o direct automaticamente",
    icon: "💬",
  },
  {
    key: "story_reply",
    title: "Resposta ao story",
    hint: "Alguém responde um story seu e o fluxo começa",
    icon: "⚡",
  },
  {
    key: "keyword",
    title: "Palavra-chave no direct",
    hint: "Alguém manda uma palavra específica no direct",
    icon: "🔑",
  },
  {
    key: "blank",
    title: "Começar do zero",
    hint: "Sem gatilho — para um fluxo chamado por menu ou link",
    icon: "◻︎",
  },
];

export function NewFlowButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [objective, setObjective] = useState<Objective | null>(null);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setOpen(false);
    setObjective(null);
    setName("");
    setPattern("");
    setMediaId(null);
    setError(null);
  };

  const needsPattern = objective === "comment" || objective === "keyword";
  const canSubmit =
    objective !== null && (!needsPattern || pattern.trim() !== "") && !saving;

  const submit = async () => {
    if (!objective) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createFlowWithObjective({
        objective,
        name,
        pattern,
        mediaId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Straight into the editor: the flow exists, the trigger exists, and
      // the only thing left is the part that needs a canvas.
      router.push(`/flows/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
      >
        + Novo fluxo
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white"
      >
        + Novo fluxo
      </button>

      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
        onClick={close}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-white text-left shadow-xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">O que deve iniciar este fluxo?</h2>
            <button
              onClick={close}
              className="rounded px-2 text-lg leading-none text-neutral-400 hover:text-neutral-700"
              aria-label="Fechar"
            >
              ×
            </button>
          </div>

          <div className="space-y-4 p-4">
            <div className="space-y-1">
              {OBJECTIVES.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => {
                    setObjective(o.key);
                    setError(null);
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
                    objective === o.key
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  <span className="text-base leading-none">{o.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{o.title}</span>
                    <span className="block text-[11px] leading-tight text-neutral-500">
                      {o.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {objective === "comment" && (
              <MediaPicker value={mediaId} onChange={setMediaId} />
            )}

            {needsPattern && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {objective === "comment"
                    ? "Palavra no comentário"
                    : "Palavra-chave no direct"}
                </label>
                <input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  maxLength={200}
                  autoFocus
                  placeholder={objective === "comment" ? "quero" : "preço"}
                  className="mt-1.5 w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                />
                <p className="mt-1 text-[11px] text-neutral-500">
                  Acentos, emoji e pontuação são ignorados na comparação.
                </p>
              </div>
            )}

            {objective && (
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Nome do fluxo (opcional)
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  placeholder="Deixe vazio para nomear automaticamente"
                  className="mt-1.5 w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                />
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
            <button
              onClick={close}
              className="rounded-lg border px-3 py-1.5 text-xs text-neutral-600 transition hover:bg-neutral-50"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
            >
              {saving ? "Criando…" : "Criar fluxo"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

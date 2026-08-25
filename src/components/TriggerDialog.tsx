"use client";

import { useState } from "react";
import {
  KIND_HINT,
  KIND_LABEL,
  MATCH_LABEL,
  allowsMedia,
  allowsPattern,
  requiresPattern,
  type MatchModeName,
  type TriggerKindName,
} from "../lib/trigger-rules";
import { MediaPicker } from "./MediaPicker";
import {
  createTrigger,
  deleteTrigger,
  updateTrigger,
  type TriggerView,
} from "../app/gatilhos/actions";

/**
 * Create or edit one trigger.
 *
 * The kind is chosen first and everything else follows from it — that is the
 * order the ManyChat flow uses and it is the honest order: "palavra-chave"
 * and "comentário" ask for different things, and showing a post selector on
 * a keyword trigger would be offering a control that does nothing.
 *
 * Validation is NOT duplicated here. The action owns it (see
 * lib/trigger-rules.ts), and this form renders whatever sentence comes back.
 * The only client-side gate is the submit button, which stays disabled while
 * a required pattern is empty — that is affordance, not validation.
 */

/** Kinds offered in the picker, in the order they are worth reaching for. */
const OFFERED: TriggerKindName[] = [
  "COMMENT",
  "STORY_REPLY",
  "KEYWORD",
  "STORY_MENTION",
  "DEFAULT",
];

export function TriggerDialog({
  flowId,
  flows,
  existing,
  onClose,
  onSaved,
}: {
  /** Flow the new trigger belongs to. Ignored when `flows` is given. */
  flowId?: string;
  /** When present, the dialog also lets the trigger be re-pointed. */
  flows?: Array<{ id: string; name: string }>;
  existing?: TriggerView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<TriggerKindName>(existing?.kind ?? "COMMENT");
  const [pattern, setPattern] = useState(existing?.pattern ?? "");
  const [match, setMatch] = useState<MatchModeName>(existing?.match ?? "CONTAINS");
  const [mediaId, setMediaId] = useState<string | null>(existing?.mediaId ?? null);
  const [targetFlow, setTargetFlow] = useState(existing?.flowId ?? flowId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const needsPattern = requiresPattern(kind);
  const canSubmit = targetFlow !== "" && (!needsPattern || pattern.trim() !== "") && !saving;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        flowId: targetFlow,
        kind,
        pattern,
        match,
        mediaId,
        priority: existing?.priority ?? (mediaId ? 10 : 0),
      };
      const result = existing
        ? await updateTrigger(existing.id, payload)
        : await createTrigger(payload);

      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setSaving(true);
    setError(null);
    try {
      const result = await deleteTrigger(existing.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{existing ? "Editar gatilho" : "Novo gatilho"}</h2>
          <button
            onClick={onClose}
            className="rounded px-2 text-lg leading-none text-neutral-400 hover:text-neutral-700"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Quando isto acontecer
            </label>
            <div className="mt-1.5 space-y-1">
              {OFFERED.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    kind === k
                      ? "border-emerald-400 bg-emerald-50"
                      : "border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  <div className="text-[12px] font-semibold">{KIND_LABEL[k]}</div>
                  <div className="text-[11px] leading-tight text-neutral-500">{KIND_HINT[k]}</div>
                </button>
              ))}
            </div>
          </div>

          {allowsMedia(kind) && <MediaPicker value={mediaId} onChange={setMediaId} />}

          {allowsPattern(kind) && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                {needsPattern ? "Palavra que dispara" : "Palavra que dispara (opcional)"}
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  maxLength={200}
                  placeholder={kind === "COMMENT" ? "quero" : "preço"}
                  className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                />
                <select
                  value={match}
                  onChange={(e) => setMatch(e.target.value as MatchModeName)}
                  className="rounded-lg border px-2 py-1.5 text-xs outline-none focus:border-indigo-400"
                >
                  {(["CONTAINS", "EXACT", "REGEX"] as MatchModeName[]).map((m) => (
                    <option key={m} value={m}>
                      {MATCH_LABEL[m]}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-[11px] text-neutral-500">
                {match === "REGEX"
                  ? "A expressão é testada no texto original, com acentos."
                  : "Acentos, emoji e pontuação são ignorados na comparação."}
                {!needsPattern && " Deixe vazio para valer para qualquer texto."}
              </p>
            </div>
          )}

          {flows && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Fluxo que roda
              </label>
              <select
                value={targetFlow}
                onChange={(e) => setTargetFlow(e.target.value)}
                className="mt-1.5 w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
              >
                <option value="">Escolha um fluxo…</option>
                {flows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t px-4 py-3">
          {existing &&
            (confirmingDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-rose-600">Excluir?</span>
                <button
                  onClick={remove}
                  className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white"
                >
                  Sim
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="text-xs text-neutral-500"
                >
                  Não
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs text-rose-600 transition hover:bg-rose-50"
              >
                Excluir
              </button>
            ))}
          <div className="ml-auto" />
          <button
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-xs text-neutral-600 transition hover:bg-neutral-50"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40"
          >
            {saving ? "Salvando…" : existing ? "Salvar" : "Criar gatilho"}
          </button>
        </div>
      </div>
    </div>
  );
}

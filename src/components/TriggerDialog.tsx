"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/ui/cn";

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

type Props = {
  open: boolean;
  /** Flow the new trigger belongs to. Ignored when `flows` is given. */
  flowId?: string;
  /** When present, the dialog also lets the trigger be re-pointed. */
  flows?: Array<{ id: string; name: string }>;
  existing?: TriggerView;
  onClose: () => void;
  onSaved: () => void;
};

export function TriggerDialog({ open, onClose, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {/* Remounted per opening so the form starts from `existing`, not the last edit. */}
        {open && <TriggerForm key={rest.existing?.id ?? "new"} onClose={onClose} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}

function TriggerForm({ flowId, flows, existing, onClose, onSaved }: Omit<Props, "open">) {
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
        toast.error(result.error);
        return;
      }
      toast.success(existing ? "Gatilho salvo." : "Gatilho criado.");
      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar.";
      setError(message);
      toast.error(message);
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
        toast.error(result.error);
        return;
      }
      toast.success("Gatilho excluído.");
      onSaved();
      onClose();
    } finally {
      setSaving(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{existing ? "Editar gatilho" : "Novo gatilho"}</DialogTitle>
        <DialogDescription>
          Escolha o que acontece no Instagram para o fluxo começar.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium leading-none" id="trigger-kind-label">
            Quando isto acontecer
          </p>
          <div className="mt-2 space-y-1" role="radiogroup" aria-labelledby="trigger-kind-label">
            {OFFERED.map((k) => {
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKind(k)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    active ? "border-emerald-400 bg-emerald-50" : "border-border hover:bg-accent",
                  )}
                >
                  <div className="text-[12px] font-semibold">{KIND_LABEL[k]}</div>
                  <div className="text-[11px] leading-tight text-muted-foreground">
                    {KIND_HINT[k]}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {allowsMedia(kind) && <MediaPicker value={mediaId} onChange={setMediaId} />}

        {allowsPattern(kind) && (
          <div className="space-y-1.5">
            <Label htmlFor="trigger-pattern">
              {needsPattern ? "Palavra que dispara" : "Palavra que dispara (opcional)"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="trigger-pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                maxLength={200}
                placeholder={kind === "COMMENT" ? "quero" : "preço"}
                className="min-w-0 flex-1"
              />
              <Label htmlFor="trigger-match" className="sr-only">
                Modo de comparação
              </Label>
              <Select value={match} onValueChange={(v) => setMatch(v as MatchModeName)}>
                <SelectTrigger id="trigger-match" className="w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["CONTAINS", "EXACT", "REGEX"] as MatchModeName[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MATCH_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {match === "REGEX"
                ? "A expressão é testada no texto original, com acentos."
                : "Acentos, emoji e pontuação são ignorados na comparação."}
              {!needsPattern && " Deixe vazio para valer para qualquer texto."}
            </p>
          </div>
        )}

        {flows && (
          <div className="space-y-1.5">
            <Label htmlFor="trigger-flow">Fluxo que roda</Label>
            <Select value={targetFlow} onValueChange={setTargetFlow}>
              <SelectTrigger id="trigger-flow">
                <SelectValue placeholder="Escolha um fluxo…" />
              </SelectTrigger>
              <SelectContent>
                {flows.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {error && <Callout tone="destructive">{error}</Callout>}
      </div>

      <DialogFooter className="sm:justify-between">
        {existing ? (
          <Button
            variant="outline"
            className="text-destructive hover:bg-rose-50 hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
            disabled={saving}
          >
            <Trash2 aria-hidden />
            Excluir
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving ? "Salvando…" : existing ? "Salvar" : "Criar gatilho"}
          </Button>
        </div>
      </DialogFooter>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Excluir este gatilho?"
        description="O fluxo deixa de ser iniciado por ele. Isso não pode ser desfeito."
        confirmLabel="Excluir"
        destructive
        pending={saving}
        onConfirm={remove}
      />
    </>
  );
}

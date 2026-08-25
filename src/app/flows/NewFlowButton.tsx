"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MessageSquare, Plus, Square, Zap, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { MediaPicker } from "../../components/MediaPicker";
import { createFlowWithObjective, type Objective } from "./actions";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/ui/cn";

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
  icon: LucideIcon;
}> = [
  {
    key: "comment",
    title: "Comentários na publicação ou Reel",
    hint: "Alguém comenta uma palavra e recebe o direct automaticamente",
    icon: MessageSquare,
  },
  {
    key: "story_reply",
    title: "Resposta ao story",
    hint: "Alguém responde um story seu e o fluxo começa",
    icon: Zap,
  },
  {
    key: "keyword",
    title: "Palavra-chave no direct",
    hint: "Alguém manda uma palavra específica no direct",
    icon: KeyRound,
  },
  {
    key: "blank",
    title: "Começar do zero",
    hint: "Sem gatilho, para um fluxo chamado por menu ou link",
    icon: Square,
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

  const reset = () => {
    setObjective(null);
    setName("");
    setPattern("");
    setMediaId(null);
    setError(null);
  };

  const needsPattern = objective === "comment" || objective === "keyword";
  const canSubmit = objective !== null && (!needsPattern || pattern.trim() !== "") && !saving;

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
        toast.error(result.error);
        return;
      }
      toast.success("Fluxo criado.");
      // Straight into the editor: the flow exists, the trigger exists, and
      // the only thing left is the part that needs a canvas.
      router.push(`/flows/${result.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível criar.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          Novo fluxo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>O que deve iniciar este fluxo?</DialogTitle>
          <DialogDescription>
            O gatilho nasce junto com o fluxo; você só precisa escolher o que o dispara.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1" role="radiogroup" aria-label="Objetivo">
            {OBJECTIVES.map((o) => {
              const active = objective === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setObjective(o.key);
                    setError(null);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    active ? "border-emerald-400 bg-emerald-50" : "border-border hover:bg-accent",
                  )}
                >
                  <o.icon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      active ? "text-emerald-700" : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{o.title}</span>
                    <span className="block text-[11px] leading-tight text-muted-foreground">
                      {o.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {objective === "comment" && <MediaPicker value={mediaId} onChange={setMediaId} />}

          {needsPattern && (
            <div className="space-y-1.5">
              <Label htmlFor="new-flow-pattern">
                {objective === "comment" ? "Palavra no comentário" : "Palavra-chave no direct"}
              </Label>
              <Input
                id="new-flow-pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                maxLength={200}
                autoFocus
                placeholder={objective === "comment" ? "quero" : "preço"}
              />
              <p className="text-[11px] text-muted-foreground">
                Acentos, emoji e pontuação são ignorados na comparação.
              </p>
            </div>
          )}

          {objective && (
            <div className="space-y-1.5">
              <Label htmlFor="new-flow-name">Nome do fluxo (opcional)</Label>
              <Input
                id="new-flow-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder="Deixe vazio para nomear automaticamente"
              />
            </div>
          )}

          {error && <Callout tone="destructive">{error}</Callout>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving ? "Criando…" : "Criar fluxo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

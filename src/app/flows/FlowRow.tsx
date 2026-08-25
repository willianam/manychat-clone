"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { deleteFlow, duplicateFlow, renameFlow, setFlowEnabled } from "./actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { withToast } from "@/lib/ui/action-toast";

/**
 * One row in the flow list, with its CRUD affordances.
 *
 * Client component only because renaming happens in place and deleting asks
 * for confirmation. The mutations themselves are server actions submitted by
 * plain forms, so the row keeps working without JavaScript.
 */

export type FlowRowData = {
  id: string;
  name: string;
  enabled: boolean;
  broken: boolean;
  /** Has edits saved in the editor that are not published yet. */
  hasDraft: boolean;
  steps: number;
  updatedAt: string;
  triggers: string[];
};

export function FlowRow({ flow }: { flow: FlowRowData }) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, startDelete] = useTransition();
  const deleteForm = useRef<HTMLFormElement>(null);

  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            {renaming ? (
              <form
                action={async (fd) => {
                  setRenaming(false);
                  await withToast(() => renameFlow(fd), {
                    success: "Fluxo renomeado.",
                    error: "Não foi possível renomear.",
                  });
                }}
                className="flex items-center gap-2"
              >
                <input type="hidden" name="id" value={flow.id} />
                <Label htmlFor={`rename-${flow.id}`} className="sr-only">
                  Novo nome
                </Label>
                <Input
                  id={`rename-${flow.id}`}
                  name="name"
                  defaultValue={flow.name}
                  autoFocus
                  maxLength={120}
                  onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
                  className="h-8 min-w-0 flex-1"
                />
                <SubmitButton size="sm" pendingLabel="Salvando…">
                  Salvar
                </SubmitButton>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
                  Cancelar
                </Button>
              </form>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/flows/${flow.id}`}
                    className="truncate font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {flow.name}
                  </Link>
                  <FlowStatus enabled={flow.enabled} broken={flow.broken} />
                  {flow.hasDraft && <StatusPill tone="warning">rascunho</StatusPill>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {flow.steps} {flow.steps === 1 ? "passo" : "passos"}
                  {flow.triggers.length > 0 && ` · ${flow.triggers.join(" · ")}`}
                </div>
              </>
            )}
          </div>

          {!renaming && (
            <div className="flex flex-wrap items-center gap-1.5">
              <form
                action={async (fd) => {
                  await withToast(() => setFlowEnabled(fd), {
                    success: flow.enabled ? "Fluxo desativado." : "Fluxo ativado.",
                    error: "Não foi possível alterar o fluxo.",
                  });
                }}
              >
                <input type="hidden" name="id" value={flow.id} />
                <input type="hidden" name="enabled" value={String(!flow.enabled)} />
                <SubmitButton
                  variant="outline"
                  size="sm"
                  disabled={!flow.enabled && flow.broken}
                  title={
                    !flow.enabled && flow.broken
                      ? "Corrija os erros do fluxo antes de ativar."
                      : undefined
                  }
                  className={
                    flow.enabled
                      ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                      : undefined
                  }
                >
                  {flow.enabled ? "Desativar" : "Ativar"}
                </SubmitButton>
              </form>

              <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
                <Pencil aria-hidden />
                Renomear
              </Button>

              {/* duplicateFlow redirects to the copy, so it stays a plain form action. */}
              <form action={duplicateFlow}>
                <input type="hidden" name="id" value={flow.id} />
                <SubmitButton variant="outline" size="sm" pendingLabel="Duplicando…">
                  <Copy aria-hidden />
                  Duplicar
                </SubmitButton>
              </form>

              <form
                ref={deleteForm}
                action={(fd) =>
                  startDelete(async () => {
                    await withToast(() => deleteFlow(fd), {
                      success: "Fluxo excluído.",
                      error: "Não foi possível excluir.",
                    });
                    setConfirming(false);
                  })
                }
              >
                <input type="hidden" name="id" value={flow.id} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-rose-50 hover:text-destructive"
                  onClick={() => setConfirming(true)}
                >
                  <Trash2 aria-hidden />
                  Excluir
                </Button>
              </form>
              <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={`Excluir o fluxo "${flow.name}"?`}
                description="Os gatilhos e as conversas em andamento deste fluxo também são removidos. Isso não pode ser desfeito."
                confirmLabel="Excluir"
                destructive
                pending={deleting}
                onConfirm={() => deleteForm.current?.requestSubmit()}
              />
            </div>
          )}
        </div>
      </Card>
    </li>
  );
}

function FlowStatus({ enabled, broken }: { enabled: boolean; broken: boolean }) {
  if (broken) return <StatusPill tone="destructive">com erro</StatusPill>;
  return (
    <StatusPill tone={enabled ? "success" : "neutral"}>{enabled ? "ativo" : "pausado"}</StatusPill>
  );
}

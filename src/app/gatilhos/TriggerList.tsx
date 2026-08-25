"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { KIND_LABEL, MATCH_LABEL } from "../../lib/trigger-rules";
import { TriggerDialog } from "../../components/TriggerDialog";
import { deleteTrigger, setTriggerEnabled, type TriggerView } from "./actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";

export type TriggerRowData = {
  trigger: TriggerView;
  /** Caption of the post this trigger is pinned to, when it is pinned. */
  mediaLabel: string | null;
};

/**
 * The trigger list with its mutations.
 *
 * Client-side because enabling, editing and deleting all happen in place and
 * a full navigation between each would make the list unusable for the one
 * thing it exists for: sweeping through and turning things off.
 *
 * Every mutation ends in `router.refresh()` rather than in local state. The
 * server already recomputes the conflict picture and the "realmente no ar"
 * count, and a second copy of that logic here would be the copy that is wrong.
 */
export function TriggerList({
  rows,
  flows,
}: {
  rows: TriggerRowData[];
  flows: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    { mode: "closed" } | { mode: "new" } | { mode: "edit"; trigger: TriggerView }
  >({ mode: "closed" });

  const newButton = (
    <Button onClick={() => setDialog({ mode: "new" })} disabled={flows.length === 0}>
      <Plus aria-hidden />
      Novo gatilho
    </Button>
  );

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={Zap}
          title="Nenhum gatilho ainda."
          description={
            <>
              Sem gatilho, nenhum fluxo começa sozinho: nada responde no Instagram.
              {flows.length === 0 &&
                " Crie um fluxo antes; um gatilho precisa de algo para disparar."}
            </>
          }
          action={newButton}
        />
      ) : (
        <>
          <div className="mt-6 flex justify-end">{newButton}</div>
          <ul className="mt-3 space-y-2">
            {rows.map((row) => (
              <TriggerRow
                key={row.trigger.id}
                row={row}
                onEdit={() => setDialog({ mode: "edit", trigger: row.trigger })}
              />
            ))}
          </ul>
        </>
      )}

      <TriggerDialog
        open={dialog.mode !== "closed"}
        flows={flows}
        existing={dialog.mode === "edit" ? dialog.trigger : undefined}
        onClose={() => setDialog({ mode: "closed" })}
        onSaved={() => router.refresh()}
      />
    </>
  );
}

function TriggerRow({ row, onEdit }: { row: TriggerRowData; onEdit: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const t = row.trigger;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) {
          toast.error(result.error ?? "Não foi possível concluir.");
          return;
        }
        toast.success(success);
        router.refresh();
      } catch (err) {
        toast.error("Não foi possível concluir.", {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setConfirming(false);
      }
    });
  };

  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{KIND_LABEL[t.kind] ?? t.kind}</span>
              {t.pattern && (
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-neutral-700">
                  {MATCH_LABEL[t.match]}: {t.pattern}
                </code>
              )}
              <TriggerStatus enabled={t.enabled} flowEnabled={t.flowEnabled} />
            </div>

            <div className="mt-1 text-xs text-muted-foreground">
              roda{" "}
              <Link
                href={`/flows/${t.flowId}`}
                className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {t.flowName}
              </Link>
              {t.kind === "COMMENT" && (
                <>
                  {" · "}
                  {t.mediaId
                    ? `só em: ${row.mediaLabel ?? `publicação ${t.mediaId}`}`
                    : "qualquer publicação"}
                </>
              )}
              {t.priority > 0 && ` · prioridade ${t.priority}`}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => setTriggerEnabled(t.id, !t.enabled),
                  t.enabled ? "Gatilho desativado." : "Gatilho ativado.",
                )
              }
              className={
                t.enabled
                  ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                  : undefined
              }
            >
              {t.enabled ? "Desativar" : "Ativar"}
            </Button>

            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil aria-hidden />
              Editar
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-rose-50 hover:text-destructive"
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden />
              Excluir
            </Button>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title="Excluir este gatilho?"
              description={`"${KIND_LABEL[t.kind] ?? t.kind}${t.pattern ? `: ${t.pattern}` : ""}" deixa de iniciar o fluxo ${t.flowName}.`}
              confirmLabel="Excluir"
              destructive
              pending={pending}
              onConfirm={() => run(() => deleteTrigger(t.id), "Gatilho excluído.")}
            />
          </div>
        </div>
      </Card>
    </li>
  );
}

/**
 * A trigger that is on but whose flow is paused is the failure this pill
 * exists for: it looks live in every other view and answers nothing.
 */
function TriggerStatus({ enabled, flowEnabled }: { enabled: boolean; flowEnabled: boolean }) {
  if (!enabled) return <StatusPill tone="neutral">desativado</StatusPill>;
  if (!flowEnabled) return <StatusPill tone="warning">fluxo pausado</StatusPill>;
  return <StatusPill tone="success">no ar</StatusPill>;
}

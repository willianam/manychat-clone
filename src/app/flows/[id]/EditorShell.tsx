"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlowEditor } from "../../../components/FlowEditor";
import { TriggerDialog } from "../../../components/TriggerDialog";
import type { FlowGraph } from "../../../lib/flow-schema";
import type { EditorMetrics } from "../../../server/flow-editor-metrics";
import type { StatsPeriod } from "../../../lib/stats-period";
import type { TriggerView } from "../../gatilhos/actions";
import { discardDraft, loadFlowMetrics, publishFlow, saveFlow } from "./actions";

/**
 * Client boundary for the editor; saving goes through a server action.
 *
 * The trigger dialog is hosted here rather than inside the canvas node, for
 * two reasons: a modal rendered inside a React Flow node inherits the
 * canvas's transform (it would scale and pan with the zoom), and the dialog
 * needs to survive the node being re-rendered.
 *
 * `router.refresh()` after a save re-runs the server component, so the
 * "Quando…" card shows the new trigger without a full reload — and without
 * this component keeping a second, divergent copy of the trigger list.
 */
export function EditorShell({
  flowId,
  initial,
  metrics: initialMetrics,
  triggers,
  flows,
  hasDraft,
  publishedAt,
}: {
  flowId: string;
  initial: FlowGraph;
  metrics: EditorMetrics;
  triggers: TriggerView[];
  flows: Array<{ id: string; name: string }>;
  hasDraft: boolean;
  publishedAt: string | null;
}) {
  const router = useRouter();
  // Bumped when the draft is discarded: the editor remounts on the graph
  // the refreshed server component hands back.
  const [generation, setGeneration] = useState(0);
  // The period picker re-queries through a server action; the page's own
  // numbers (30 days) are the starting point.
  const [metrics, setMetrics] = useState(initialMetrics);
  const [loadingMetrics, startMetrics] = useTransition();
  const changePeriod = (period: StatsPeriod) =>
    startMetrics(async () => {
      try {
        setMetrics(await loadFlowMetrics(flowId, period));
      } catch (err) {
        toast.error("Não foi possível carregar as métricas.", {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    });
  const [dialog, setDialog] = useState<
    { mode: "closed" } | { mode: "new" } | { mode: "edit"; trigger: TriggerView }
  >({ mode: "closed" });

  return (
    <>
      <FlowEditor
        key={generation}
        initial={initial}
        metrics={metrics}
        metricsLoading={loadingMetrics}
        onPeriodChange={changePeriod}
        flows={flows}
        triggers={triggers}
        onAddTrigger={() => setDialog({ mode: "new" })}
        onEditTrigger={(trigger) => setDialog({ mode: "edit", trigger })}
        onSave={async (graph) => {
          try {
            await saveFlow(flowId, graph);
            toast.success("Rascunho salvo.");
            router.refresh();
          } catch (err) {
            toast.error("Não foi possível salvar.", {
              description: err instanceof Error ? err.message : undefined,
            });
            throw err;
          }
        }}
        draft={{
          hasDraft,
          publishedAt,
          onPublish: async () => {
            try {
              await publishFlow(flowId);
              toast.success("Fluxo publicado.");
              router.refresh();
            } catch (err) {
              toast.error("Não foi possível publicar.", {
                description: err instanceof Error ? err.message : undefined,
              });
              throw err;
            }
          },
          onDiscard: async () => {
            try {
              await discardDraft(flowId);
              toast.success("Rascunho descartado.");
              router.refresh();
              setGeneration((g) => g + 1);
            } catch (err) {
              toast.error("Não foi possível descartar.", {
                description: err instanceof Error ? err.message : undefined,
              });
              throw err;
            }
          },
        }}
      />

      <TriggerDialog
        open={dialog.mode !== "closed"}
        flowId={flowId}
        existing={dialog.mode === "edit" ? dialog.trigger : undefined}
        onClose={() => setDialog({ mode: "closed" })}
        onSaved={() => router.refresh()}
      />
    </>
  );
}

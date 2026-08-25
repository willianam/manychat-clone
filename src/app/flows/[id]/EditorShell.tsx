"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlowEditor } from "../../../components/FlowEditor";
import { TriggerDialog } from "../../../components/TriggerDialog";
import type { FlowGraph } from "../../../lib/flow-schema";
import type { FlowStats } from "../../../server/flow-metrics";
import type { TriggerView } from "../../gatilhos/actions";
import { discardDraft, publishFlow, saveFlow } from "./actions";

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
  stats,
  triggers,
  hasDraft,
  publishedAt,
}: {
  flowId: string;
  initial: FlowGraph;
  stats?: FlowStats;
  triggers: TriggerView[];
  hasDraft: boolean;
  publishedAt: string | null;
}) {
  const router = useRouter();
  // Bumped when the draft is discarded: the editor remounts on the graph
  // the refreshed server component hands back.
  const [generation, setGeneration] = useState(0);
  const [dialog, setDialog] = useState<
    { mode: "closed" } | { mode: "new" } | { mode: "edit"; trigger: TriggerView }
  >({ mode: "closed" });

  return (
    <>
      <FlowEditor
        key={generation}
        initial={initial}
        stats={stats}
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

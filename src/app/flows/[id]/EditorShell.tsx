"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlowEditor } from "../../../components/FlowEditor";
import { TriggerDialog } from "../../../components/TriggerDialog";
import type { FlowGraph } from "../../../lib/flow-schema";
import type { FlowStats } from "../../../server/flow-metrics";
import type { TriggerView } from "../../gatilhos/actions";
import { saveFlow } from "./actions";

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
}: {
  flowId: string;
  initial: FlowGraph;
  stats?: FlowStats;
  triggers: TriggerView[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    { mode: "closed" } | { mode: "new" } | { mode: "edit"; trigger: TriggerView }
  >({ mode: "closed" });

  return (
    <>
      <FlowEditor
        initial={initial}
        stats={stats}
        triggers={triggers}
        onAddTrigger={() => setDialog({ mode: "new" })}
        onEditTrigger={(trigger) => setDialog({ mode: "edit", trigger })}
        onSave={async (graph) => {
          await saveFlow(flowId, graph);
        }}
      />

      {dialog.mode !== "closed" && (
        <TriggerDialog
          flowId={flowId}
          existing={dialog.mode === "edit" ? dialog.trigger : undefined}
          onClose={() => setDialog({ mode: "closed" })}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}

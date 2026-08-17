"use client";

import { FlowEditor } from "../../../components/FlowEditor";
import type { FlowGraph } from "../../../lib/flow-schema";
import type { FlowStats } from "../../../server/flow-metrics";
import { saveFlow } from "./actions";

/** Client boundary for the editor; saving goes through a server action. */
export function EditorShell({
  flowId,
  initial,
  stats,
}: {
  flowId: string;
  initial: FlowGraph;
  stats?: FlowStats;
}) {
  return (
    <FlowEditor
      flowId={flowId}
      initial={initial}
      stats={stats}
      onSave={async (graph) => {
        await saveFlow(flowId, graph);
      }}
    />
  );
}

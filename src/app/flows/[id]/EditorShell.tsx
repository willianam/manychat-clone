"use client";

import { FlowEditor } from "../../../components/FlowEditor";
import type { FlowGraph } from "../../../lib/flow-schema";

/**
 * Client boundary for the preview. Save is a no-op that just logs — the
 * point here is to exercise the canvas and the live validator, not to
 * persist.
 */
export function EditorShell({ flowId, initial }: { flowId: string; initial: FlowGraph }) {
  return (
    <FlowEditor
      flowId={flowId}
      initial={initial}
      onSave={async (graph) => {
        console.log("[preview] save is disabled; graph would be:", graph);
        alert(`Preview: ${graph.nodes.length} nós validados com sucesso (nada foi salvo).`);
      }}
    />
  );
}

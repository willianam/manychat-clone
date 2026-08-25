"use client";

import { Download } from "lucide-react";
import type { FlowGraph } from "../../../lib/flow-schema";
import { exportFilename, serializeFlow } from "../../../lib/flow-io";
import { Button } from "@/components/ui/button";

/**
 * "Exportar" — downloads the flow as JSON.
 *
 * Built entirely in the browser from a Blob: the graph is already on the
 * client, so a round trip to the server would only add latency and a route to
 * maintain.
 *
 * Note this exports the *saved* graph the page was rendered with, not unsaved
 * canvas edits — which is why the label says so next to the button.
 */
export function ExportFlowButton({ name, graph }: { name: string; graph: FlowGraph }) {
  const download = () => {
    const blob = new Blob([serializeFlow(name, graph)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename(name);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={download}
      title="Baixa o fluxo salvo como arquivo .json"
    >
      <Download aria-hidden />
      <span className="hidden sm:inline">Exportar</span>
    </Button>
  );
}

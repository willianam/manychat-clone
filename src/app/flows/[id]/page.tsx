import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { db } from "../../../server/db";
import { flowStats } from "../../../server/flow-metrics";
import { FlowGraph } from "../../../lib/flow-schema";
import { triggersOfFlow } from "../../gatilhos/actions";
import { EditorShell } from "./EditorShell";
import { ExportFlowButton } from "./ExportFlowButton";
import { Button } from "@/components/ui/button";
import { GuardedLink } from "@/components/ui/guarded-link";
import { StatusPill } from "@/components/ui/status-pill";

export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = await db.flow.findUnique({ where: { id } });
  if (!flow) notFound();

  // The editor opens on the draft when there is one; the runner keeps
  // reading `graph` until the draft is published.
  const graph = FlowGraph.parse(flow.draftGraph ?? flow.graph);
  const stats = await flowStats(db, flow.id);
  // Triggers are table rows, not graph nodes — the editor draws them as the
  // synthetic "Quando…" card at the top of the canvas.
  const triggers = await triggersOfFlow(flow.id);
  // For "Ir para outro fluxo".
  const flows = await db.flow.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <main className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center gap-3 border-b bg-card px-4 py-2 md:px-6">
        <Button asChild variant="ghost" size="icon" className="shrink-0">
          <GuardedLink href="/flows" aria-label="Voltar para fluxos">
            <ArrowLeft aria-hidden />
          </GuardedLink>
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-medium">{flow.name}</h1>
            <StatusPill tone={flow.enabled ? "success" : "neutral"}>
              {flow.enabled ? "ativo" : "pausado"}
            </StatusPill>
          </div>
          <p className="hidden text-xs text-muted-foreground md:block">
            Duplo clique edita o texto. Selecione um bloco para abrir as propriedades. Os números
            aparecem depois que o fluxo roda.
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <GuardedLink href={`/flows/${flow.id}/preview`}>
              <Eye aria-hidden />
              <span className="hidden sm:inline">Ver como conversa</span>
            </GuardedLink>
          </Button>
          <ExportFlowButton name={flow.name} graph={graph} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <EditorShell
          flowId={flow.id}
          initial={graph}
          stats={stats}
          triggers={triggers}
          flows={flows}
          hasDraft={flow.draftGraph !== null}
          publishedAt={flow.publishedAt?.toISOString() ?? null}
        />
      </div>
    </main>
  );
}

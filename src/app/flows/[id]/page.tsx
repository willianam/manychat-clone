import Link from "next/link";
import { db } from "../../../server/db";
import { flowStats } from "../../../server/flow-metrics";
import { FlowGraph } from "../../../lib/flow-schema";
import { triggersOfFlow } from "../../gatilhos/actions";
import { EditorShell } from "./EditorShell";
import { ExportFlowButton } from "./ExportFlowButton";

export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = await db.flow.findUnique({ where: { id } });
  if (!flow) return <main className="p-8">Fluxo não encontrado.</main>;

  const graph = FlowGraph.parse(flow.graph);
  const stats = await flowStats(db, flow.id);
  // Triggers are table rows, not graph nodes — the editor draws them as the
  // synthetic "Quando…" card at the top of the canvas.
  const triggers = await triggersOfFlow(flow.id);

  return (
    <main>
      <div className="flex items-center gap-3 border-b bg-white px-6 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href="/flows" className="text-xs text-neutral-500 hover:underline">
              ← Fluxos
            </Link>
            <h1 className="truncate font-medium">{flow.name}</h1>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                flow.enabled ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {flow.enabled ? "ativo" : "pausado"}
            </span>
          </div>
          <p className="text-xs text-neutral-500">
            Duplo clique edita o texto. Selecione um bloco para abrir as propriedades. Os números
            aparecem depois que o fluxo roda.
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link
            href={`/flows/${flow.id}/preview`}
            className="rounded-lg border px-3 py-1 text-xs font-medium transition hover:bg-neutral-50"
          >
            Ver como conversa
          </Link>
          <ExportFlowButton name={flow.name} graph={graph} />
        </div>
      </div>
      <EditorShell flowId={flow.id} initial={graph} stats={stats} triggers={triggers} />
    </main>
  );
}

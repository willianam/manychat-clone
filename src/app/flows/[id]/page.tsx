import { db } from "../../../server/db";
import { flowStats } from "../../../server/flow-metrics";
import { FlowGraph } from "../../../lib/flow-schema";
import { EditorShell } from "./EditorShell";

export const dynamic = "force-dynamic";

export default async function FlowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const flow = await db.flow.findUnique({ where: { id } });
  if (!flow) return <main className="p-8">Fluxo não encontrado.</main>;

  const graph = FlowGraph.parse(flow.graph);
  const stats = await flowStats(db, flow.id);

  return (
    <main>
      <div className="border-b bg-white px-6 py-3">
        <h1 className="font-medium">{flow.name}</h1>
        <p className="text-xs text-neutral-500">
          Arraste os nós e ligue as saídas. Os números aparecem depois que o fluxo roda.
        </p>
      </div>
      <EditorShell flowId={flow.id} initial={graph} stats={stats} />
    </main>
  );
}

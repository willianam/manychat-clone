import { db } from "../../server/db";
import { FlowGraph, validateGraph } from "../../lib/flow-schema";
import { FlowRow } from "./FlowRow";
import { NewFlowButton } from "./NewFlowButton";
import { ImportFlowButton } from "./ImportFlowButton";

export const dynamic = "force-dynamic";

export default async function FlowsPage() {
  const flows = await db.flow.findMany({
    include: { triggers: true },
    orderBy: { updatedAt: "desc" },
  });

  // Surface broken flows in the list. A flow that cannot run is worth knowing
  // about here, not on the day someone messages the account.
  const rows = flows.map((f) => {
    const parsed = FlowGraph.safeParse(f.graph);
    const broken = !parsed.success
      ? true
      : validateGraph(parsed.data).some((i) => i.level === "error");

    return {
      id: f.id,
      name: f.name,
      enabled: f.enabled,
      broken,
      steps: parsed.success ? parsed.data.nodes.length : 0,
      updatedAt: f.updatedAt.toISOString(),
      triggers: f.triggers.map((t) =>
        t.pattern ? `${t.kind.toLowerCase()}: "${t.pattern}"` : t.kind.toLowerCase(),
      ),
    };
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Fluxos</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {flows.length} {flows.length === 1 ? "fluxo" : "fluxos"} ·{" "}
            {flows.filter((f) => f.enabled).length} ativo(s)
          </p>
        </div>

        <div className="flex items-start gap-2">
          <ImportFlowButton />
          <NewFlowButton />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">Nenhum fluxo ainda.</p>
          <p className="mt-1 text-sm text-neutral-500">
            Crie o primeiro acima escolhendo o que deve iniciá-lo — comentário, resposta a story ou
            palavra-chave. O gatilho nasce junto com o fluxo.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {rows.map((f) => (
            <FlowRow key={f.id} flow={f} />
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-neutral-400">
        Um fluxo ativo responde no Instagram assim que um gatilho casa. Fluxos com erro não podem
        ser ativados.
      </p>
    </main>
  );
}

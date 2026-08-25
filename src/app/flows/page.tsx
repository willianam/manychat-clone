import { Workflow } from "lucide-react";
import { db } from "../../server/db";
import { FlowGraph, validateGraph } from "../../lib/flow-schema";
import { FlowRow } from "./FlowRow";
import { NewFlowButton } from "./NewFlowButton";
import { ImportFlowButton } from "./ImportFlowButton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { triggerKindLabel } from "@/lib/ui/labels";

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
        t.pattern ? `${triggerKindLabel(t.kind)}: "${t.pattern}"` : triggerKindLabel(t.kind),
      ),
    };
  });

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Fluxos"
        description={`${flows.length} ${flows.length === 1 ? "fluxo" : "fluxos"} · ${
          flows.filter((f) => f.enabled).length
        } ativo(s)`}
        actions={
          <>
            <ImportFlowButton />
            <NewFlowButton />
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={Workflow}
          title="Nenhum fluxo ainda."
          description="Crie o primeiro acima escolhendo o que deve iniciá-lo: comentário, resposta a story ou palavra-chave. O gatilho nasce junto com o fluxo."
        />
      ) : (
        <ul className="mt-6 space-y-2">
          {rows.map((f) => (
            <FlowRow key={f.id} flow={f} />
          ))}
        </ul>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Um fluxo ativo responde no Instagram assim que um gatilho casa. Fluxos com erro não podem
        ser ativados.
      </p>
    </main>
  );
}

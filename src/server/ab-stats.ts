import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { FlowGraph, armLabel } from "../lib/flow-schema";

/**
 * A/B results for one randomizer node.
 *
 * "Sessions" is how many runs were sent down each arm; "goals" is how many
 * of those runs later passed through ANY goal node of the flow. Both come
 * from rows the runner writes as it goes (AbAssignment, FlowGoalHit), so the
 * numbers are exact rather than reconstructed from message text.
 */
export type ArmStats = {
  handle: string;
  label: string;
  weight: number;
  sessions: number;
  goals: number;
  /** goals / sessions as a percentage, or null with no sessions yet. */
  rate: number | null;
};

/**
 * The published graph, already read and validated by the caller.
 *
 * editorMetrics parses it once to find the randomizer nodes; without this
 * parameter every arm in the loop re-read the same Flow row — the graph JSON
 * is the heaviest column in the schema — and re-ran the same Zod parse.
 */
export type ResolvedGraph = z.infer<typeof FlowGraph>;

export async function abStats(
  db: PrismaClient,
  flowId: string,
  nodeId: string,
  resolved?: ResolvedGraph,
): Promise<ArmStats[]> {
  let graphData: ResolvedGraph;
  if (resolved) {
    graphData = resolved;
  } else {
    const flow = await db.flow.findUnique({ where: { id: flowId } });
    if (!flow) return [];
    const parsed = FlowGraph.safeParse(flow.graph);
    if (!parsed.success) return [];
    graphData = parsed.data;
  }
  const node = graphData.nodes.find((n) => n.id === nodeId);
  if (!node || node.data.kind !== "random") return [];
  const d = node.data;

  const assignments = await db.abAssignment.findMany({
    where: { flowId, nodeId },
    select: { sessionId: true, handle: true },
  });

  const sessionIds = assignments.map((a) => a.sessionId);
  const hits = sessionIds.length
    ? await db.flowGoalHit.findMany({
        where: { flowId, sessionId: { in: sessionIds } },
        select: { sessionId: true },
      })
    : [];
  // A session that passes two goals is one converted session, not two.
  const converted = new Set(hits.map((h) => h.sessionId));

  return d.weights.map((weight, i) => {
    const handle = String(i);
    const mine = assignments.filter((a) => a.handle === handle);
    const goals = mine.filter((a) => converted.has(a.sessionId)).length;
    return {
      handle,
      label: armLabel(d, i),
      weight,
      sessions: mine.length,
      goals,
      rate: mine.length ? Math.round((goals / mine.length) * 1000) / 10 : null,
    };
  });
}

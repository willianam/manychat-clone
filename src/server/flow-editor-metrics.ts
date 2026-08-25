import type { PrismaClient } from "@prisma/client";
import { FlowGraph } from "../lib/flow-schema";
import { periodRange, type StatsPeriod } from "../lib/stats-period";
import { abStats, type ArmStats } from "./ab-stats";
import { flowFunnel, type FlowFunnel } from "./flow-funnel";
import { flowStats, type FlowStats } from "./flow-metrics";

/**
 * Everything the canvas draws numbers from, for one flow and one period:
 * per-node delivery (`flowStats`), per-arm A/B results for every randomizer
 * (`abStats`, which is not period-bound — an assignment is for life) and
 * the funnel. One call so the page and the period picker share a shape.
 *
 * Reads the PUBLISHED graph for the randomizer list, like abStats itself:
 * a draft arm that never ran has no assignments to report.
 */
export type EditorMetrics = {
  period: StatsPeriod;
  stats: FlowStats;
  ab: Record<string, ArmStats[]>;
  funnel: FlowFunnel | null;
};

export async function editorMetrics(
  db: PrismaClient,
  flowId: string,
  period: StatsPeriod,
  now = new Date(),
): Promise<EditorMetrics> {
  const { from, to } = periodRange(period, now);

  const flow = await db.flow.findUnique({ where: { id: flowId } });
  const graph = flow ? FlowGraph.safeParse(flow.graph) : null;
  const randomIds = graph?.success
    ? graph.data.nodes.filter((n) => n.data.kind === "random").map((n) => n.id)
    : [];

  const [stats, arms, funnel] = await Promise.all([
    flowStats(db, flowId, { from, to }),
    Promise.all(randomIds.map(async (id) => [id, await abStats(db, flowId, id)] as const)),
    flowFunnel(db, flowId, from ?? new Date(0), to),
  ]);

  return { period, stats, ab: Object.fromEntries(arms), funnel };
}

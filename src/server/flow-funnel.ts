import { Prisma, type PrismaClient } from "@prisma/client";
import { FlowGraph } from "../lib/flow-schema";

/**
 * Funnel for one flow over a period: how many runs started, how far they
 * got, how they ended.
 *
 * "Reached" a node means a session that either sent a message from it
 * (`Message.payload.meta`, written by sendMessage) or is parked on it
 * (`FlowSession.currentNodeId`). The two are merged by max, not sum: a
 * session parked on a question has also sent that question, and counting
 * it twice would show a node reached by more sessions than started.
 *
 * Silent nodes (condition, action, tag, random) that never send and are
 * never parked on show as 0 — the funnel reads off the messages, and those
 * nodes leave no trace. Sessions from before nodeId attribution existed
 * count in `started` but not in any node.
 */

export type FlowFunnel = {
  from: Date;
  to: Date;
  started: number;
  completed: number;
  abandoned: number;
  /** Still ACTIVE or WAITING_INPUT. */
  inProgress: number;
  /** Graph order, so the UI can draw the funnel top to bottom. */
  nodes: Array<{ nodeId: string; kind: string; reached: number }>;
  /** Goal hits for this flow, or null when no goal source exists yet. */
  goals: number;
};

type ReachedRow = { nodeId: string | null; sessions: number };

export async function flowFunnel(
  db: PrismaClient,
  flowId: string,
  from: Date,
  to: Date,
): Promise<FlowFunnel | null> {
  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow) return null;
  const graph = FlowGraph.safeParse(flow.graph);
  if (!graph.success) return null;

  const startedAt = { gte: from, lte: to };

  const [started, completed, abandoned, parked, sent, goals] = await Promise.all([
    db.flowSession.count({ where: { flowId, startedAt } }),
    db.flowSession.count({ where: { flowId, startedAt, status: "COMPLETED" } }),
    db.flowSession.count({ where: { flowId, startedAt, status: "ABANDONED" } }),
    db.flowSession.groupBy({
      by: ["currentNodeId"],
      where: { flowId, startedAt, currentNodeId: { not: null } },
      _count: { _all: true },
    }),
    db.$queryRaw<ReachedRow[]>(Prisma.sql`
      SELECT m.payload->'meta'->>'nodeId' AS "nodeId",
             COUNT(DISTINCT m.payload->'meta'->>'sessionId')::int AS sessions
      FROM "Message" m
      JOIN "FlowSession" s ON s.id = m.payload->'meta'->>'sessionId'
      WHERE m.direction = 'OUTBOUND'
        AND m.payload->'meta'->>'flowId' = ${flowId}
        AND s."startedAt" >= ${from} AND s."startedAt" <= ${to}
      GROUP BY 1`),
    goalCount(db, flowId, startedAt),
  ]);

  const reached = new Map<string, number>();
  for (const r of sent) if (r.nodeId) reached.set(r.nodeId, r.sessions);
  for (const p of parked) {
    if (!p.currentNodeId) continue;
    reached.set(p.currentNodeId, Math.max(reached.get(p.currentNodeId) ?? 0, p._count._all));
  }

  return {
    from,
    to,
    started,
    completed,
    abandoned,
    inProgress: started - completed - abandoned,
    nodes: graph.data.nodes.map((n) => ({
      nodeId: n.id,
      kind: n.data.kind,
      reached: reached.get(n.id) ?? 0,
    })),
    goals,
  };
}

/** FlowGoalHit rows for the flow in the range (see the goal node in flow-runner.ts). */
async function goalCount(
  db: PrismaClient,
  flowId: string,
  at: { gte: Date; lte: Date },
): Promise<number> {
  return db.flowGoalHit.count({ where: { flowId, at } });
}

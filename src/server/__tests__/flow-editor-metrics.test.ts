import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { editorMetrics } from "../flow-editor-metrics";

const GRAPH = {
  nodes: [
    { id: "m1", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "oi" } },
    {
      id: "r1",
      type: "random",
      position: { x: 0, y: 0 },
      data: { kind: "random", weights: [50, 50], labels: ["A", "B"] },
    },
    { id: "e1", type: "end", position: { x: 0, y: 0 }, data: { kind: "end" } },
  ],
  edges: [],
};

function fakeDb() {
  const queryRaw = vi.fn().mockResolvedValue([]);
  const db = {
    flow: { findUnique: vi.fn().mockResolvedValue({ id: "f1", graph: GRAPH }) },
    flowSession: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    flowGoalHit: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([{ sessionId: "s1" }]),
    },
    abAssignment: {
      findMany: vi.fn().mockResolvedValue([
        { sessionId: "s1", handle: "0" },
        { sessionId: "s2", handle: "1" },
      ]),
    },
    $queryRaw: queryRaw,
  } as unknown as PrismaClient;
  return { db, queryRaw };
}

describe("editorMetrics", () => {
  it("bundles per-node stats, A/B arms for every randomizer and the funnel", async () => {
    const { db } = fakeDb();
    const now = new Date("2026-08-25T12:00:00Z");
    const m = await editorMetrics(db, "f1", "30d", now);

    expect(m.period).toBe("30d");
    expect(Object.keys(m.stats).sort()).toEqual(["e1", "m1", "r1"]);
    expect(m.ab.r1?.map((a) => [a.label, a.sessions, a.goals])).toEqual([
      ["A", 1, 1],
      ["B", 1, 0],
    ]);
    expect(m.funnel?.from).toEqual(new Date("2026-07-26T12:00:00Z"));
    expect(m.funnel?.nodes.map((n) => n.nodeId)).toEqual(["m1", "r1", "e1"]);
  });

  it("'all' asks the funnel from the epoch and the stats without a lower bound", async () => {
    const { db, queryRaw } = fakeDb();
    const m = await editorMetrics(db, "f1", "all");
    expect(m.funnel?.from).toEqual(new Date(0));
    const sqls = queryRaw.mock.calls.map((c) => (c[0] as { sql: string }).sql);
    expect(sqls.some((s) => s.includes('"createdAt" >='))).toBe(false);
  });
});

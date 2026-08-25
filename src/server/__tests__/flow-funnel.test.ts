import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { flowFunnel } from "../flow-funnel";

const GRAPH = {
  nodes: [
    { id: "m1", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "oi" } },
    {
      id: "q1",
      type: "question",
      position: { x: 0, y: 0 },
      data: { kind: "question", text: "nome?", saveAs: "nome" },
    },
    {
      id: "t1",
      type: "tag",
      position: { x: 0, y: 0 },
      data: { kind: "tag", tagName: "x", action: "add" },
    },
    { id: "e1", type: "end", position: { x: 0, y: 0 }, data: { kind: "end" } },
  ],
  edges: [],
};

function fakeDb() {
  const db = {
    flow: { findUnique: vi.fn().mockResolvedValue({ id: "f1", graph: GRAPH }) },
    flowSession: {
      count: vi.fn(async ({ where }: { where: { status?: string } }) =>
        where.status === "COMPLETED" ? 4 : where.status === "ABANDONED" ? 3 : 10,
      ),
      groupBy: vi.fn().mockResolvedValue([{ currentNodeId: "q1", _count: { _all: 3 } }]),
    },
    flowGoalHit: { count: vi.fn().mockResolvedValue(0) },
    $queryRaw: vi.fn().mockResolvedValue([
      { nodeId: "m1", sessions: 10 },
      { nodeId: "q1", sessions: 7 },
    ]),
  } as unknown as PrismaClient;
  return db;
}

const from = new Date("2026-08-01T03:00:00Z");
const to = new Date("2026-08-31T03:00:00Z");

describe("flowFunnel", () => {
  it("reports starts, outcomes and per-node reach in graph order", async () => {
    const f = await flowFunnel(fakeDb(), "f1", from, to);

    expect(f).toMatchObject({
      started: 10,
      completed: 4,
      abandoned: 3,
      inProgress: 3,
      goals: 0,
    });
    expect(f!.nodes).toEqual([
      { nodeId: "m1", kind: "message", reached: 10 },
      // 7 sent from q1, 3 parked on it: max, not sum.
      { nodeId: "q1", kind: "question", reached: 7 },
      { nodeId: "t1", kind: "tag", reached: 0 },
      { nodeId: "e1", kind: "end", reached: 0 },
    ]);
  });

  it("a parked node with no sends still counts as reached", async () => {
    const db = fakeDb();
    vi.mocked(db.$queryRaw).mockResolvedValue([]);
    const f = await flowFunnel(db, "f1", from, to);
    expect(f!.nodes.find((n) => n.nodeId === "q1")!.reached).toBe(3);
  });

  it("scopes every query to the period", async () => {
    const db = fakeDb();
    await flowFunnel(db, "f1", from, to);
    for (const c of vi.mocked(db.flowSession.count).mock.calls) {
      expect(c[0]!.where).toMatchObject({ flowId: "f1", startedAt: { gte: from, lte: to } });
    }
    const raw = vi.mocked(db.$queryRaw).mock.calls[0][0] as { values: unknown[] };
    expect(raw.values).toEqual(expect.arrayContaining(["f1", from, to]));
  });

  it("counts goal hits for the flow in the range", async () => {
    const db = fakeDb();
    vi.mocked(db.flowGoalHit.count).mockResolvedValue(2);
    expect((await flowFunnel(db, "f1", from, to))!.goals).toBe(2);
  });

  it("is null for an unknown flow", async () => {
    const db = fakeDb();
    vi.mocked(db.flow.findUnique).mockResolvedValue(null);
    expect(await flowFunnel(db, "nope", from, to)).toBeNull();
  });
});

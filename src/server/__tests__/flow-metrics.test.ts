import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { flowStats } from "../flow-metrics";

/**
 * The three raw queries run in a fixed order — tagged sends, legacy sends,
 * taps — so the fake answers them positionally and records the SQL text for
 * assertions on the period filter.
 */
const GRAPH = {
  nodes: [
    { id: "m1", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "oi" } },
    {
      id: "q1",
      type: "quickreply",
      position: { x: 0, y: 0 },
      data: {
        kind: "quickreply",
        text: "escolha",
        saveAs: "opt",
        options: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
      },
    },
  ],
  edges: [{ id: "e", source: "m1", target: "q1" }],
};

function fakeDb(answers: unknown[][]) {
  const queryRaw = vi.fn();
  for (const a of answers) queryRaw.mockResolvedValueOnce(a);
  const db = {
    flow: { findUnique: vi.fn().mockResolvedValue({ id: "f1", graph: GRAPH }) },
    $queryRaw: queryRaw,
  } as unknown as PrismaClient;
  return { db, queryRaw };
}

describe("flowStats", () => {
  it("counts tagged sends from the DB aggregate, by node and status", async () => {
    const { db } = fakeDb([
      [
        { nodeId: "m1", status: "READ", n: 3 },
        { nodeId: "m1", status: "SENT", n: 1 },
        { nodeId: "m1", status: "FAILED", n: 1 },
        { nodeId: "q1", status: "DELIVERED", n: 2 },
      ],
      [],
      [{ payload: "q1:a", n: 1 }],
    ]);

    const s = await flowStats(db, "f1");

    expect(s.m1).toMatchObject({ sent: 5, delivered: 4, read: 3, failed: 1, deliveredPct: 80 });
    expect(s.m1!.readPct).toBe(60);
    expect(s.q1).toMatchObject({ sent: 2, clickedPct: 50, byHandle: { a: 1, b: 0 } });
  });

  it("adds legacy rows without meta by text, or by the node id in the payload", async () => {
    const { db } = fakeDb([
      [{ nodeId: "m1", status: "SENT", n: 1 }],
      [
        { text: "oi", status: "SENT", payload: { text: "oi" } },
        { text: "escolha", status: "FAILED", payload: { quick_replies: [{ payload: "q1:a" }] } },
        { text: "outra coisa", status: "SENT", payload: null },
      ],
      [],
    ]);

    const s = await flowStats(db, "f1");

    expect(s.m1!.sent).toBe(2);
    expect(s.q1).toMatchObject({ sent: 1, failed: 1, deliveredPct: 0 });
  });

  it("passes the period and the limit down to the queries", async () => {
    const { db, queryRaw } = fakeDb([[], [], []]);
    const from = new Date("2026-08-01T00:00:00Z");
    const to = new Date("2026-08-31T23:59:59Z");

    await flowStats(db, "f1", { from, to, limit: 50 });

    const sqls = queryRaw.mock.calls.map((c) => c[0] as { sql: string; values: unknown[] });
    expect(sqls).toHaveLength(3);
    for (const q of sqls) {
      expect(q.sql).toContain(">=");
      expect(q.sql).toContain("<=");
      expect(q.values).toEqual(expect.arrayContaining([from, to]));
    }
    expect(sqls[1]!.sql).toContain("LIMIT");
    expect(sqls[1]!.values).toContain(50);
    expect(sqls[2]!.sql).toContain('"WebhookEvent"');
  });

  it("is empty for an unknown flow", async () => {
    const db = {
      flow: { findUnique: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn(),
    } as unknown as PrismaClient;
    expect(await flowStats(db, "nope")).toEqual({});
  });
});

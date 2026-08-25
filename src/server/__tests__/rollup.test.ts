import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { rollupDay, rollupRecent, dayBounds, dayOf, METRICS } from "../rollup";
import { dailySeries, listDays, lastDays } from "../stats";

const ORIGINAL = { ...process.env };
beforeEach(() => {
  process.env.ACCOUNT_TIMEZONE = "America/Sao_Paulo";
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

function fakeDb() {
  const upsert = vi.fn().mockResolvedValue({});
  const db = {
    contact: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        "unsubscribedAt" in where ? 2 : 7,
      ),
    },
    message: {
      count: vi.fn(async ({ where }: { where: { direction: string } }) =>
        where.direction === "INBOUND" ? 40 : 55,
      ),
    },
    broadcastRecipient: { count: vi.fn().mockResolvedValue(12) },
    triggerFire: {
      groupBy: vi.fn().mockResolvedValue([
        { triggerId: "t1", _count: { _all: 5 } },
        { triggerId: "t2", _count: { _all: 1 } },
      ]),
    },
    dailyStat: { upsert, findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
  return { db, upsert };
}

describe("day arithmetic in the account timezone", () => {
  it("assigns an instant to the São Paulo calendar day, not the UTC one", () => {
    // 01:30 UTC on the 26th is still the 25th in São Paulo (UTC-3).
    expect(dayOf(new Date("2026-08-26T01:30:00Z"))).toBe("2026-08-25");
  });

  it("bounds a day as [local midnight, next local midnight)", () => {
    const { start, end } = dayBounds("2026-08-25");
    expect(start.toISOString()).toBe("2026-08-25T03:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-26T03:00:00.000Z");
  });

  it("rolls over month ends", () => {
    expect(dayBounds("2026-08-31").end.toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });
});

describe("rollupDay", () => {
  it("writes absolute values per metric, keyed per trigger, as upserts", async () => {
    const { db, upsert } = fakeDb();

    const rows = await rollupDay(db, "2026-08-25");

    expect(rows).toEqual(
      expect.arrayContaining([
        { metric: METRICS.contactsNew, key: "", value: 7 },
        { metric: METRICS.messagesIn, key: "", value: 40 },
        { metric: METRICS.messagesOut, key: "", value: 55 },
        { metric: METRICS.broadcastsSent, key: "", value: 12 },
        { metric: METRICS.optOuts, key: "", value: 2 },
        { metric: METRICS.triggerFires, key: "t1", value: 5 },
        { metric: METRICS.triggerFires, key: "t2", value: 1 },
      ]),
    );
    // No goal source on this client: no goals rows.
    expect(rows.some((r) => r.metric === METRICS.goals)).toBe(false);

    const first = upsert.mock.calls[0][0];
    expect(first.where.date_metric_key.date.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(first.update).toEqual({ value: first.create.value });
    expect(upsert).toHaveBeenCalledTimes(rows.length);
  });

  it("queries the source tables with the local-day range", async () => {
    const { db } = fakeDb();
    await rollupDay(db, "2026-08-25");
    const where = vi.mocked(db.message.count).mock.calls[0][0]!.where as {
      createdAt: { gte: Date; lt: Date };
    };
    expect(where.createdAt.gte.toISOString()).toBe("2026-08-25T03:00:00.000Z");
    expect(where.createdAt.lt.toISOString()).toBe("2026-08-26T03:00:00.000Z");
  });

  it("counts goals when a FlowGoalHit model is present on the client", async () => {
    const { db } = fakeDb();
    (db as unknown as Record<string, unknown>).flowGoalHit = {
      groupBy: vi.fn().mockResolvedValue([{ flowId: "f1", _count: { _all: 3 } }]),
    };
    const rows = await rollupDay(db, "2026-08-25");
    expect(rows).toContainEqual({ metric: METRICS.goals, key: "f1", value: 3 });
  });

  it("rollupRecent covers yesterday and today", async () => {
    const { db } = fakeDb();
    const days = await rollupRecent(db, new Date("2026-08-26T01:30:00Z"));
    expect(days).toEqual(["2026-08-24", "2026-08-25"]);
  });
});

describe("stats", () => {
  it("lists days inclusively and zero-fills the series", async () => {
    expect(listDays("2026-08-30", "2026-09-01")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);

    const { db } = fakeDb();
    vi.mocked(db.dailyStat.findMany).mockResolvedValue([
      { date: new Date("2026-08-31T00:00:00Z"), value: 4 },
    ] as never);

    const series = await dailySeries(db, {
      metric: METRICS.messagesIn,
      from: "2026-08-30",
      to: "2026-09-01",
    });
    expect(series).toEqual([
      { date: "2026-08-30", value: 0 },
      { date: "2026-08-31", value: 4 },
      { date: "2026-09-01", value: 0 },
    ]);
    expect(vi.mocked(db.dailyStat.findMany).mock.calls[0][0]!.where).toMatchObject({ key: "" });
  });

  it("lastDays ends today and spans the requested count", () => {
    expect(lastDays(7, new Date("2026-08-26T01:30:00Z"))).toEqual({
      from: "2026-08-19",
      to: "2026-08-25",
    });
  });
});

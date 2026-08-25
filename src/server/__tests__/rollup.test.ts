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
    contact: { count: vi.fn().mockResolvedValue(7) },
    // Opt-outs are counted from the event log, not Contact.unsubscribedAt.
    contactEvent: { count: vi.fn().mockResolvedValue(2) },
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
    flowGoalHit: { groupBy: vi.fn().mockResolvedValue([]) },
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
    // No goal hits in the range: no goals rows.
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

  it("counts opt-outs from the event log, not the mutable contact field", async () => {
    const { db } = fakeDb();
    const rows = await rollupDay(db, "2026-08-25");

    // Contact.unsubscribedAt is nulled on re-opt-in, so counting it would
    // rewrite an old day's number downward every time someone came back.
    expect(db.contactEvent.count).toHaveBeenCalledWith({
      where: {
        kind: "UNSUBSCRIBED",
        createdAt: { gte: expect.any(Date), lt: expect.any(Date) },
      },
    });
    const contactWheres = vi
      .mocked(db.contact.count)
      .mock.calls.map((c) => JSON.stringify(c[0]?.where ?? {}));
    expect(contactWheres.some((w) => w.includes("unsubscribedAt"))).toBe(false);

    expect(rows).toContainEqual({ metric: METRICS.optOuts, key: "", value: 2 });
  });

  it("counts goal hits per flow", async () => {
    const { db } = fakeDb();
    vi.mocked(db.flowGoalHit.groupBy).mockResolvedValue([
      { flowId: "f1", _count: { _all: 3 } },
    ] as never);
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

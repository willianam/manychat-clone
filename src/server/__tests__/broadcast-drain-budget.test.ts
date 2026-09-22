import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("../instagram", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { runBroadcast, WEBHOOK_DRAIN_BUDGET_MS } from "../broadcast-worker";
import { sendMessage } from "../instagram";

/// Same live-clock reasoning as broadcast-lock.test.ts: canSend measures
/// against the real clock, so the fixture's contacts must sit inside the
/// 24h window now, not on the day this file was written.
const NOW = new Date();

/**
 * A fake Prisma that is honest about the two things this suite is about:
 * the conditional claim (a row flips only if its current state satisfies the
 * where) and recipient status transitions (a row leaves PENDING the moment
 * it is attempted, which is what makes a resume non-duplicating).
 */
function fakeDb(recipientCount: number, init: { status?: string; lockedAt?: Date | null } = {}) {
  const b = {
    id: "b1",
    name: "promo",
    text: "oi",
    content: null,
    flowId: null,
    tag: null,
    status: init.status ?? "QUEUED",
    lockedAt: init.lockedAt ?? null,
  };
  const rows = Array.from({ length: recipientCount }, (_, i) => ({
    id: `r${i}`,
    contactId: `c${i}`,
    status: "PENDING",
    error: null as string | null,
    sentAt: null as Date | null,
    contact: { lastInboundAt: NOW },
  }));

  const matches = (where: { OR: Array<{ status: string; lockedAt?: null | { lt: Date } }> }) =>
    where.OR.some((c) => {
      if (c.status !== b.status) return false;
      if (c.lockedAt === undefined) return true;
      if (c.lockedAt === null) return b.lockedAt === null;
      return b.lockedAt !== null && b.lockedAt < c.lockedAt.lt;
    });

  const db = {
    broadcast: {
      findUniqueOrThrow: vi.fn(async () => ({ ...b })),
      updateMany: vi.fn(async ({ where, data }: { where: never; data: object }) => {
        if (!matches(where)) return { count: 0 };
        Object.assign(b, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: object }) => Object.assign(b, data)),
    },
    broadcastRecipient: {
      findMany: vi.fn(
        async ({ where, take }: { where: { status?: string }; take?: number }) => {
          const hit = rows.filter((r) => !where.status || r.status === where.status);
          return (take ? hit.slice(0, take) : hit).map((r) => ({ ...r }));
        },
      ),
      count: vi.fn(async ({ where }: { where: { status?: string } }) =>
        rows.filter((r) => !where.status || r.status === where.status).length,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
        Object.assign(
          rows.find((r) => r.id === where.id)!,
          data,
        );
        return {};
      }),
    },
  };
  return { db: db as unknown as PrismaClient, b, rows };
}

/** A clock that advances a fixed amount per read — no real waiting. */
function tickingClock(stepMs: number) {
  let t = 0;
  return () => (t += stepMs);
}

const noWait = async () => {};

beforeEach(() => vi.mocked(sendMessage).mockClear());

describe("drain time budget", () => {
  it("stops on budget, returns the lock and reports what is left", async () => {
    const { db, b, rows } = fakeDb(50);

    // 1s per clock read against a 9s budget: the loop gives up long before
    // the 50 recipients are exhausted.
    const r = await runBroadcast(db, "b1", {
      budgetMs: WEBHOOK_DRAIN_BUDGET_MS,
      now: tickingClock(1_000),
      wait: noWait,
    });

    expect(r.claimed).toBe(true);
    expect(r.stopped).toBe("budget");
    expect(r.sent).toBeGreaterThan(0);
    expect(r.sent).toBeLessThan(50);
    expect(r.remaining).toBe(50 - r.sent);

    // The lock is handed back, not abandoned in SENDING.
    expect(b.status).toBe("QUEUED");
    expect(b.lockedAt).toBeNull();

    // Every row is either finished or still PENDING — none half-way.
    expect(rows.filter((x) => x.status === "SENT")).toHaveLength(r.sent);
    expect(rows.filter((x) => x.status === "PENDING")).toHaveLength(r.remaining);
  });

  it("a resume continues from the right point and sends nobody twice", async () => {
    const { db, b, rows } = fakeDb(12);
    const seen: string[] = [];
    vi.mocked(sendMessage).mockImplementation(async (_db, contactId) => {
      seen.push(contactId as string);
    });

    // Three passes, each budgeted so tightly that only a handful get out.
    let guard = 0;
    let last = await runBroadcast(db, "b1", {
      budgetMs: 4_000,
      now: tickingClock(1_000),
      wait: noWait,
    });
    expect(last.stopped).toBe("budget");
    const firstPass = last.sent;
    expect(firstPass).toBeGreaterThan(0);
    expect(firstPass).toBeLessThan(12);

    while (last.stopped === "budget" && guard++ < 20) {
      // A fresh drainer can claim immediately: no waiting out the 10min lock.
      last = await runBroadcast(db, "b1", {
        budgetMs: 4_000,
        now: tickingClock(1_000),
        wait: noWait,
      });
    }

    expect(last.stopped).toBe("drained");
    expect(b.status).toBe("DONE");
    expect(b.lockedAt).toBeNull();

    // The critical property: 12 real DMs, 12 sends, no contact twice.
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect([...seen].sort()).toEqual([...rows.map((x) => x.contactId)].sort());
    expect(rows.every((x) => x.status === "SENT")).toBe(true);

    vi.mocked(sendMessage).mockResolvedValue(undefined);
  });

  it("a second drainer cannot enter while the first still holds the claim", async () => {
    const { db } = fakeDb(10, { status: "SENDING", lockedAt: new Date() });
    const r = await runBroadcast(db, "b1", { budgetMs: 4_000, wait: noWait });
    expect(r.claimed).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("without a budget the drain runs to exhaustion — the dedicated worker path", async () => {
    const { db, b } = fakeDb(7);
    const r = await runBroadcast(db, "b1", { wait: noWait });
    expect(r).toMatchObject({ claimed: true, sent: 7, stopped: "drained", remaining: 0 });
    expect(b).toMatchObject({ status: "DONE", lockedAt: null });
  });
});

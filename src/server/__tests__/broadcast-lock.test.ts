import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("../instagram", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import {
  runBroadcast,
  claimBroadcast,
  broadcastReport,
  retryFailed,
  isWindowError,
  BROADCAST_LOCK_MS,
} from "../broadcast-worker";
import { sendMessage } from "../instagram";

/// Live, not a frozen literal: the fixture's recipient must sit INSIDE the
/// 24h messaging window, which canSend() measures against the real clock.
/// A hardcoded date silently rots the suite the day after it is written.
const NOW = new Date();
const WINDOW_ERR =
  "Outside the 24h messaging window (last inbound 30h ago). Use a message tag or wait for the contact to write again.";

/**
 * A fake Prisma whose broadcast.updateMany honours the conditional where the
 * way Postgres would: the row flips only if its current status/lockedAt
 * satisfy one branch of the OR. That is the whole point of the lock, so the
 * fake has to be honest about it.
 */
function fakeDb(
  init: { status: string; lockedAt: Date | null; tag?: string | null },
  recipients: Array<Record<string, unknown>> = [],
) {
  const b = {
    id: "b1",
    name: "promo",
    text: "oi",
    content: null,
    flowId: null,
    tag: null,
    ...init,
  };
  const rows = recipients.map((r, i) => ({
    id: `r${i}`,
    contactId: `c${i}`,
    status: "PENDING",
    error: null,
    contact: { lastInboundAt: NOW, username: `u${i}`, name: null },
    ...r,
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
      findMany: vi.fn(async ({ where }: { where: { status?: string } }) =>
        rows.filter((r) => !where.status || r.status === where.status),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
        Object.assign(
          rows.find((r) => r.id === where.id)!,
          data,
        );
        return {};
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: { in: string[] } }; data: object }) => {
          for (const r of rows) if (where.id.in.includes(r.id)) Object.assign(r, data);
          return { count: where.id.in.length };
        },
      ),
      groupBy: vi.fn(async () => {
        const by = new Map<string, number>();
        for (const r of rows) by.set(r.status as string, (by.get(r.status as string) ?? 0) + 1);
        return [...by].map(([status, n]) => ({ status, _count: { _all: n } }));
      }),
    },
  };
  return { db: db as unknown as PrismaClient, b, rows };
}

describe("broadcast lock", () => {
  it("only the first of two concurrent runs claims the broadcast", async () => {
    const { db, b } = fakeDb({ status: "QUEUED", lockedAt: null }, [{}]);
    const [a, c] = await Promise.all([runBroadcast(db, "b1"), runBroadcast(db, "b1")]);
    const claimed = [a, c].filter((r) => r.claimed);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ sent: 1 });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(b).toMatchObject({ status: "DONE", lockedAt: null });
  });

  it("a live SENDING claim is refused; an expired one is taken over", async () => {
    const fresh = fakeDb({ status: "SENDING", lockedAt: new Date(NOW.getTime() - 60_000) });
    expect(await claimBroadcast(fresh.db, "b1", NOW)).toBe(false);

    const stale = fakeDb({
      status: "SENDING",
      lockedAt: new Date(NOW.getTime() - BROADCAST_LOCK_MS - 1),
    });
    expect(await claimBroadcast(stale.db, "b1", NOW)).toBe(true);
    expect(stale.b.lockedAt).toEqual(NOW);

    // Legacy rows: SENDING from before the lock existed have no lockedAt.
    const legacy = fakeDb({ status: "SENDING", lockedAt: null });
    expect(await claimBroadcast(legacy.db, "b1", NOW)).toBe(true);
  });

  it("DONE and DRAFT are never claimed", async () => {
    expect(await claimBroadcast(fakeDb({ status: "DONE", lockedAt: null }).db, "b1")).toBe(false);
    expect(await claimBroadcast(fakeDb({ status: "DRAFT", lockedAt: null }).db, "b1")).toBe(false);
  });
});

describe("report and retry", () => {
  it("isWindowError recognises canSend reasons only", () => {
    expect(isWindowError(WINDOW_ERR)).toBe(true);
    expect(
      isWindowError(
        "Contact has never sent us a message. Instagram forbids initiating a conversation.",
      ),
    ).toBe(true);
    expect(isWindowError("(#10) Application does not have permission")).toBe(false);
    expect(isWindowError(null)).toBe(false);
  });

  it("broadcastReport counts by status and lists only retryable errors", async () => {
    const { db } = fakeDb({ status: "DONE", lockedAt: null }, [
      { status: "SENT" },
      { status: "READ" },
      { status: "FAILED", error: WINDOW_ERR },
      { status: "FAILED", error: "HTTP 500" },
      { status: "PENDING" },
    ]);
    const r = await broadcastReport(db, "b1");
    expect(r.counts).toEqual({ pending: 1, sent: 2, failed: 2, total: 5 });
    expect(r.errors).toEqual([{ contactId: "c3", username: "u3", name: null, error: "HTTP 500" }]);
    expect(r.outOfWindow).toBe(1);
  });

  it("retryFailed re-queues non-window failures and reopens the broadcast", async () => {
    const { db, b, rows } = fakeDb({ status: "DONE", lockedAt: null }, [
      { status: "FAILED", error: WINDOW_ERR },
      { status: "FAILED", error: "HTTP 500" },
      { status: "SENT" },
    ]);
    expect(await retryFailed(db, "b1")).toBe(1);
    expect(rows[1]).toMatchObject({ status: "PENDING", error: null });
    expect(rows[0]).toMatchObject({ status: "FAILED" });
    expect(b).toMatchObject({ status: "QUEUED", lockedAt: null });
  });

  it("retryFailed with nothing retryable leaves the broadcast alone", async () => {
    const { db, b } = fakeDb({ status: "DONE", lockedAt: null }, [
      { status: "FAILED", error: WINDOW_ERR },
    ]);
    expect(await retryFailed(db, "b1")).toBe(0);
    expect(b.status).toBe("DONE");
  });
});

describe("message tags", () => {
  it("a HUMAN_AGENT broadcast reaches a contact 3 days out and passes the tag to sendMessage", async () => {
    vi.mocked(sendMessage).mockClear();
    const threeDays = new Date(Date.now() - 3 * 24 * 3_600_000);
    const { db, rows } = fakeDb({ status: "QUEUED", lockedAt: null, tag: "HUMAN_AGENT" }, [
      { contact: { lastInboundAt: threeDays, username: "u", name: null } },
    ]);
    const r = await runBroadcast(db, "b1");
    expect(r).toMatchObject({ sent: 1, skipped: 0 });
    expect(sendMessage).toHaveBeenCalledWith(
      db,
      "c0",
      { text: "oi" },
      { preview: "oi", tag: "HUMAN_AGENT" },
    );
    expect(rows[0]!.status).toBe("SENT");
  });

  it("without a tag the same contact is skipped; an unknown tag is ignored", async () => {
    vi.mocked(sendMessage).mockClear();
    const threeDays = new Date(Date.now() - 3 * 24 * 3_600_000);
    const { db } = fakeDb({ status: "QUEUED", lockedAt: null, tag: "MADE_UP" }, [
      { contact: { lastInboundAt: threeDays, username: "u", name: null } },
    ]);
    expect(await runBroadcast(db, "b1")).toMatchObject({ sent: 0, skipped: 1 });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

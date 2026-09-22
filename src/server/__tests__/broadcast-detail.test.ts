import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  broadcastDetail,
  bucketOf,
  cancelBroadcast,
  duplicateBroadcast,
} from "../broadcast-detail";

const WINDOW_ERR = "Outside the 24h messaging window (last inbound 30h ago). Use a message tag.";

describe("bucketOf", () => {
  it("splits FAILED into skipped (window) and failed (everything else)", () => {
    expect(bucketOf("FAILED", WINDOW_ERR)).toBe("skipped");
    expect(bucketOf("FAILED", "Contact has never sent us a message. Instagram forbids it.")).toBe(
      "skipped",
    );
    expect(bucketOf("FAILED", "(#10) permission denied")).toBe("failed");
    expect(bucketOf("READ", null)).toBe("read");
    expect(bucketOf("PENDING", null)).toBe("pending");
  });
});

describe("broadcastDetail", () => {
  const rows = [
    {
      id: "r1",
      contactId: "c1",
      status: "READ",
      error: null,
      sentAt: new Date(),
      contact: { username: "a", name: null },
    },
    {
      id: "r2",
      contactId: "c2",
      status: "SENT",
      error: null,
      sentAt: new Date(),
      contact: { username: "b", name: "B" },
    },
    {
      id: "r3",
      contactId: "c3",
      status: "FAILED",
      error: WINDOW_ERR,
      sentAt: null,
      contact: { username: null, name: null },
    },
    {
      id: "r4",
      contactId: "c4",
      status: "FAILED",
      error: "boom",
      sentAt: null,
      contact: { username: "d", name: null },
    },
    {
      id: "r5",
      contactId: "c5",
      status: "PENDING",
      error: null,
      sentAt: null,
      contact: { username: "e", name: null },
    },
  ];
  /**
   * The counts now come from `groupBy` plus one `count` for the window
   * failures, and the table from a `where`d/`take`n query — the service no
   * longer pulls every recipient and filters in JS. The fake applies the
   * same status/error predicates the database would.
   */
  const matches = (
    row: (typeof rows)[number],
    where: Record<string, unknown> | undefined,
  ): boolean => {
    if (!where) return true;
    if (where.status && row.status !== where.status) return false;
    const phraseHit = (clause: { OR: Array<{ error: { contains: string } }> }) =>
      clause.OR.some((o) => (row.error ?? "").toLowerCase().includes(o.error.contains.toLowerCase()));
    if (where.OR && !phraseHit(where as { OR: Array<{ error: { contains: string } }> })) return false;
    if (where.NOT && phraseHit(where.NOT as { OR: Array<{ error: { contains: string } }> }))
      return false;
    return true;
  };

  const db = {
    broadcastRecipient: {
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
        return [...counts].map(([status, n]) => ({ status, _count: { _all: n } }));
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => matches(r, where)).length,
      ),
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
        rows.filter((r) => matches(r, where)).slice(0, take),
      ),
    },
  } as unknown as PrismaClient;

  it("counts every bucket and returns all rows unfiltered", async () => {
    const d = await broadcastDetail(db, "b1");
    expect(d.counts).toEqual({
      pending: 1,
      sent: 1,
      delivered: 0,
      read: 1,
      failed: 1,
      skipped: 1,
      total: 5,
    });
    expect(d.recipients.map((r) => r.bucket)).toEqual([
      "read",
      "sent",
      "skipped",
      "failed",
      "pending",
    ]);
  });

  it("filters the table by bucket without changing the counts", async () => {
    const d = await broadcastDetail(db, "b1", { bucket: "failed" });
    expect(d.counts.total).toBe(5);
    expect(d.recipients).toHaveLength(1);
    expect(d.recipients[0]).toMatchObject({ contactId: "c4", error: "boom" });
  });
});

describe("duplicateBroadcast", () => {
  it("copies body, audience and tag into a DRAFT, dropping schedule and recipients", async () => {
    const create = vi.fn(async ({ data }: { data: object }) => ({ id: "b2", ...data }));
    const db = {
      broadcast: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "b1",
          name: "promo",
          text: null,
          content: { kind: "message", text: "x" },
          flowId: null,
          tag: "HUMAN_AGENT",
          filterTagIds: ["t1"],
          segmentId: null,
          status: "DONE",
          scheduledAt: new Date(),
        }),
        create,
      },
    } as unknown as PrismaClient;
    const copy = await duplicateBroadcast(db, "b1");
    expect(copy.id).toBe("b2");
    expect(create.mock.calls[0][0].data).toEqual({
      name: "promo (cópia)",
      text: null,
      content: { kind: "message", text: "x" },
      flowId: null,
      tag: "HUMAN_AGENT",
      filterTagIds: ["t1"],
      segmentId: null,
      status: "DRAFT",
    });
  });
});

describe("cancelBroadcast", () => {
  it("returns a QUEUED broadcast to DRAFT and removes its recipients", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const db = {
      broadcast: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      broadcastRecipient: { deleteMany },
    } as unknown as PrismaClient;
    expect(await cancelBroadcast(db, "b1")).toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({ where: { broadcastId: "b1" } });
  });

  it("refuses anything that is not QUEUED and leaves recipients alone", async () => {
    const deleteMany = vi.fn();
    const db = {
      broadcast: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      broadcastRecipient: { deleteMany },
    } as unknown as PrismaClient;
    expect(await cancelBroadcast(db, "b1")).toBe(false);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

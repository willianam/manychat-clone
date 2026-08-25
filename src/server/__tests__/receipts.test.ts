import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { applyReadReceipt, applyDelivery } from "../receipts";

function fakeDb(opts: { contact?: boolean; lastCreatedAt?: Date } = {}) {
  const updateMany = vi.fn().mockResolvedValue({ count: 2 });
  const db = {
    contact: {
      findUnique: vi.fn().mockResolvedValue(opts.contact === false ? null : { id: "c1" }),
    },
    message: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts.lastCreatedAt ? { createdAt: opts.lastCreatedAt } : null),
      updateMany,
    },
  } as unknown as PrismaClient;
  return { db, updateMany };
}

describe("applyReadReceipt", () => {
  it("marks every SENT/DELIVERED outbound at or before the watermark as READ", async () => {
    const { db, updateMany } = fakeDb();
    const watermark = new Date("2026-08-25T12:00:00Z");

    const n = await applyReadReceipt(db, { kind: "read", igScopedId: "ig1", watermark });

    expect(n).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        contactId: "c1",
        direction: "OUTBOUND",
        status: { in: ["SENT", "DELIVERED"] },
        createdAt: { lte: watermark },
      },
      data: { status: "READ" },
    });
  });

  it("turns an Instagram read.mid into a watermark at that message's createdAt", async () => {
    const at = new Date("2026-08-25T13:00:00Z");
    const { db, updateMany } = fakeDb({ lastCreatedAt: at });

    await applyReadReceipt(db, { kind: "read", igScopedId: "ig1", mid: "mid.9" });

    expect(updateMany.mock.calls[0][0].where.createdAt).toEqual({ lte: at });
  });

  it("does nothing for an unknown mid with no watermark, or an unknown contact", async () => {
    const a = fakeDb();
    expect(await applyReadReceipt(a.db, { kind: "read", igScopedId: "ig1", mid: "nope" })).toBe(0);
    expect(a.updateMany).not.toHaveBeenCalled();

    const b = fakeDb({ contact: false });
    expect(
      await applyReadReceipt(b.db, { kind: "read", igScopedId: "ig1", watermark: new Date() }),
    ).toBe(0);
  });
});

describe("applyDelivery", () => {
  it("marks the named mids DELIVERED, then the rest under the watermark", async () => {
    const { db, updateMany } = fakeDb();
    const watermark = new Date("2026-08-25T12:00:00Z");

    const n = await applyDelivery(db, {
      kind: "delivery",
      igScopedId: "ig1",
      mids: ["m1", "m2"],
      watermark,
    });

    expect(n).toBe(4);
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { contactId: "c1", externalId: { in: ["m1", "m2"] }, status: "SENT" },
      data: { status: "DELIVERED" },
    });
    // Only SENT rows move: a READ row must never be demoted by a late receipt.
    expect(updateMany.mock.calls[1][0].where).toMatchObject({
      status: "SENT",
      createdAt: { lte: watermark },
      externalId: { notIn: ["m1", "m2"] },
    });
  });

  it("skips the mid update when there are no mids", async () => {
    const { db, updateMany } = fakeDb();
    await applyDelivery(db, {
      kind: "delivery",
      igScopedId: "ig1",
      mids: [],
      watermark: new Date(),
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

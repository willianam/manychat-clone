import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { applyReadReceipt, applyDelivery } from "../receipts";

function fakeDb(
  opts: { contact?: boolean; lastCreatedAt?: Date; recipient?: { id: string } | null } = {},
) {
  const updateMany = vi.fn().mockResolvedValue({ count: 2 });
  const recipientUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  // The newest recipient row still awaiting the status; null when none.
  const recipientFindFirst = vi
    .fn()
    .mockResolvedValue(opts.recipient === undefined ? { id: "r-latest" } : opts.recipient);
  const db = {
    broadcastRecipient: { updateMany: recipientUpdateMany, findFirst: recipientFindFirst },
    contact: {
      findUnique: vi.fn().mockResolvedValue(opts.contact === false ? null : { id: "c1" }),
    },
    message: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts.lastCreatedAt ? { createdAt: opts.lastCreatedAt } : null),
      findFirst: vi
        .fn()
        .mockResolvedValue(opts.lastCreatedAt ? { createdAt: opts.lastCreatedAt } : null),
      updateMany,
    },
  } as unknown as PrismaClient;
  return { db, updateMany, recipientUpdateMany, recipientFindFirst };
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

describe("broadcast recipients follow the receipts", () => {
  it("a read watermark advances only the contact's most recent recipient row", async () => {
    const { db, recipientUpdateMany, recipientFindFirst } = fakeDb();
    const watermark = new Date("2026-08-25T12:00:00Z");
    await applyReadReceipt(db, { kind: "read", igScopedId: "ig1", watermark });

    // The candidate is the newest pending row at or before the watermark.
    expect(recipientFindFirst).toHaveBeenCalledWith({
      where: {
        contactId: "c1",
        status: { in: ["SENT", "DELIVERED"] },
        sentAt: { lte: watermark },
      },
      orderBy: { sentAt: "desc" },
      select: { id: true },
    });
    // And only that row is written — never a whole span of history.
    expect(recipientUpdateMany).toHaveBeenCalledWith({
      where: { id: "r-latest" },
      data: { status: "READ" },
    });
  });

  it("does not sweep older broadcasts of the same contact into READ", async () => {
    const { db, recipientUpdateMany } = fakeDb();
    await applyReadReceipt(db, {
      kind: "read",
      igScopedId: "ig1",
      watermark: new Date("2026-08-25T12:00:00Z"),
    });

    // The regression: a where clause spanning every past send for the
    // contact inflated the read rate of every historical broadcast.
    const where = recipientUpdateMany.mock.calls[0]![0].where;
    expect(where).toEqual({ id: "r-latest" });
    expect(where).not.toHaveProperty("sentAt");
    expect(where).not.toHaveProperty("contactId");
  });

  it("a delivery by mid anchors the candidate on that message's createdAt", async () => {
    const at = new Date("2026-08-25T13:00:00Z");
    const { db, recipientUpdateMany, recipientFindFirst } = fakeDb({ lastCreatedAt: at });
    await applyDelivery(db, { kind: "delivery", igScopedId: "ig1", mids: ["m1"] });

    expect(recipientFindFirst).toHaveBeenCalledWith({
      where: { contactId: "c1", status: { in: ["SENT"] }, sentAt: { lte: at } },
      orderBy: { sentAt: "desc" },
      select: { id: true },
    });
    expect(recipientUpdateMany).toHaveBeenCalledWith({
      where: { id: "r-latest" },
      data: { status: "DELIVERED" },
    });
  });

  it("touches no recipient when there is nothing to anchor a watermark on", async () => {
    const { db, recipientUpdateMany } = fakeDb();
    await applyDelivery(db, { kind: "delivery", igScopedId: "ig1", mids: [] });
    expect(recipientUpdateMany).not.toHaveBeenCalled();
  });

  it("touches no recipient when the contact has no pending broadcast row", async () => {
    const { db, recipientUpdateMany } = fakeDb({ recipient: null });
    await applyReadReceipt(db, {
      kind: "read",
      igScopedId: "ig1",
      watermark: new Date("2026-08-25T12:00:00Z"),
    });
    expect(recipientUpdateMany).not.toHaveBeenCalled();
  });
});

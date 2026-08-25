import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { claim, runClaimed, reprocessFailed, receiptKey, MAX_ATTEMPTS } from "../webhook-events";

vi.mock("../instagram", () => ({
  fetchProfile: vi.fn().mockResolvedValue({}),
  sendText: vi.fn(),
  sendMessage: vi.fn(),
  sendPrivateReply: vi.fn(),
  sendSenderActionToContact: vi.fn(),
  SendBlocked: class SendBlocked extends Error {},
}));

function fakeDb(failedRows: Array<{ id: string; kind: string; raw: unknown }> = []) {
  const update = vi.fn().mockResolvedValue({});
  const db = {
    webhookEvent: {
      create: vi.fn().mockResolvedValue({ id: "row-1" }),
      update,
      findMany: vi.fn().mockResolvedValue(failedRows),
    },
    contact: { findUnique: vi.fn().mockResolvedValue({ id: "c1" }) },
    message: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    broadcastRecipient: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      // Receipts advance only the newest pending recipient row; this contact
      // has none, so nothing is written.
      findFirst: vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaClient;
  return { db, update };
}

describe("claim", () => {
  it("returns the row id once, and null for a replay", async () => {
    const { db } = fakeDb();
    expect(await claim(db, "mid.1", "message", {})).toBe("row-1");
    vi.mocked(db.webhookEvent.create).mockRejectedValueOnce(new Error("unique"));
    expect(await claim(db, "mid.1", "message", {})).toBeNull();
  });
});

describe("runClaimed", () => {
  it("stamps processedAt and clears the error on success", async () => {
    const { db, update } = fakeDb();
    expect(await runClaimed(db, "row-1", async () => {})).toBe(true);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: "row-1" },
      data: { processedAt: expect.any(Date), error: null, attempts: { increment: 1 } },
    });
  });

  it("records the failure and swallows it, so the batch goes on", async () => {
    const { db, update } = fakeDb();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = await runClaimed(db, "row-1", async () => {
      throw new Error("Meta 503");
    });
    quiet.mockRestore();
    expect(ok).toBe(false);
    expect(update.mock.calls[0][0].data).toEqual({ error: "Meta 503", attempts: { increment: 1 } });
    expect(update.mock.calls[0][0].data.processedAt).toBeUndefined();
  });
});

describe("reprocessFailed", () => {
  it("retries only unprocessed rows with an error and attempts below the cap", async () => {
    const { db } = fakeDb();
    await reprocessFailed(db);
    expect(vi.mocked(db.webhookEvent.findMany).mock.calls[0][0]).toMatchObject({
      where: { processedAt: null, error: { not: null }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { receivedAt: "asc" },
    });
    expect(MAX_ATTEMPTS).toBe(2);
  });

  it("re-runs the stored raw event through its handler and reports recovery", async () => {
    const readEvent = { sender: { id: "IG1" }, read: { watermark: 1755000000000 } };
    const { db, update } = fakeDb([{ id: "row-9", kind: "read", raw: readEvent }]);

    const r = await reprocessFailed(db);

    expect(r).toEqual({ retried: 1, recovered: 1 });
    // The read receipt handler actually ran against the stored payload.
    expect(db.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "READ" } }),
    );
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: "row-9" },
      data: { processedAt: expect.any(Date), error: null },
    });
  });
});

describe("receiptKey", () => {
  it("keys reads and deliveries by sender and marker, and is null otherwise", () => {
    expect(receiptKey({ sender: { id: "A" }, read: { mid: "m1" } })).toBe("read:A:m1");
    expect(receiptKey({ sender: { id: "A" }, delivery: { watermark: 5 } })).toBe("delivery:A:5");
    expect(receiptKey({ sender: { id: "A" }, message: { text: "oi" } })).toBeNull();
  });
});

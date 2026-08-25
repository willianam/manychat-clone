import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * `Contact.lastMessageAt` orders the inbox. It has to move on every Message
 * write, in either direction, and must never be the reason a write fails.
 */

vi.mock("../token-refresh", () => ({ getAccessToken: vi.fn().mockResolvedValue("tok") }));

import { recordInboundMessage } from "../inbound-attachments";
import { sendMessage } from "../instagram";
import { touchLastMessage } from "../last-message";

function fakeDb(opts: { lastInboundAt?: Date | null; failTouch?: boolean } = {}) {
  return {
    contact: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: "c1",
        igScopedId: "IG1",
        lastInboundAt: opts.lastInboundAt === undefined ? new Date() : opts.lastInboundAt,
      })),
      update: opts.failTouch
        ? vi.fn().mockRejectedValue(new Error("db down"))
        : vi.fn().mockResolvedValue({}),
    },
    message: {
      create: vi.fn(async ({ data }: { data: object }) => ({ id: "m1", ...data })),
      upsert: vi.fn(async ({ create }: { create: object }) => ({ id: "m1", ...create })),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("lastMessageAt", () => {
  it("is touched when an inbound message is recorded", async () => {
    const db = fakeDb();
    const now = new Date("2026-08-27T10:00:00Z");
    await recordInboundMessage(db, { contactId: "c1", mid: "mid-1", text: "oi" }, now);
    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { lastMessageAt: now },
    });
  });

  it("is touched when an outbound message is sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message_id: "mid-2" }) }),
    );
    const db = fakeDb();
    await sendMessage(db, "c1", { text: "olá" }, { preview: "olá" });
    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { lastMessageAt: expect.any(Date) },
    });
    vi.unstubAllGlobals();
  });

  it("is touched even when the window blocks the send (the failed row is in the thread)", async () => {
    const db = fakeDb({ lastInboundAt: null });
    await expect(sendMessage(db, "c1", { text: "olá" })).rejects.toThrow();
    expect(db.contact.update).toHaveBeenCalledTimes(1);
  });

  it("never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeDb({ failTouch: true });
    await expect(touchLastMessage(db, "c1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

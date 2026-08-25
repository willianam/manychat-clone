import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * `meta` must land in Message.payload.meta and must NOT be sent to Meta —
 * the Graph API rejects unknown keys inside `message`.
 */

const ORIGINAL = { ...process.env };

vi.mock("../db", () => ({
  db: {
    igCredential: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async ({ create }: { create: object }) => ({
        expiresAt: null,
        refreshedAt: null,
        lastError: null,
        ...create,
      })),
    },
  },
}));

function fakeDb() {
  const create = vi.fn().mockResolvedValue({ id: "msg-1" });
  const db = {
    contact: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: "c1", igScopedId: "IG1", lastInboundAt: new Date() }),
    },
    message: { create, update: vi.fn().mockResolvedValue({}) },
    igCredential: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(async ({ create }: { create: object }) => ({ ...create })),
    },
  } as unknown as PrismaClient;
  return { db, create };
}

beforeEach(() => {
  process.env.IG_ACCESS_TOKEN = "t";
  vi.resetModules();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

describe("sendMessage meta", () => {
  it("stores meta on the row and keeps it out of the wire payload", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message_id: "mid.1" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { sendText } = await import("../instagram");
    const { db, create } = fakeDb();
    const meta = { flowId: "f1", nodeId: "n1", sessionId: "s1" };

    await sendText(db, "c1", "olá", { meta });

    expect(create.mock.calls[0][0].data.payload).toEqual({ text: "olá", meta });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message).toEqual({ text: "olá" });
  });

  it("keeps meta on a row blocked by the messaging window, too", async () => {
    const { sendText, SendBlocked } = await import("../instagram");
    const { db, create } = fakeDb();
    vi.mocked(db.contact.findUniqueOrThrow).mockResolvedValue({
      id: "c1",
      igScopedId: "IG1",
      lastInboundAt: null,
    } as never);
    const meta = { flowId: "f1", nodeId: "n1", sessionId: "s1" };

    await expect(sendText(db, "c1", "olá", { meta })).rejects.toBeInstanceOf(SendBlocked);
    expect(create.mock.calls[0][0].data).toMatchObject({ status: "FAILED", payload: { meta } });
  });
});

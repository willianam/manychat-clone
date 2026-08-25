import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { checkHealth } from "../health";
import { recordError } from "../error-events";

const ORIGINAL = { ...process.env };
beforeEach(() => {
  process.env.IG_ACCESS_TOKEN = "secret-token-value";
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

function fakeDb(opts: { dbDown?: boolean } = {}) {
  const now = new Date("2026-08-25T12:00:00Z");
  return {
    $queryRaw: opts.dbDown
      ? vi.fn().mockRejectedValue(new Error("connection refused"))
      : vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    igCredential: {
      findUnique: vi.fn().mockResolvedValue({
        accessToken: "secret-token-value",
        expiresAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
        refreshedAt: now,
        lastError: null,
      }),
    },
    message: {
      findFirst: vi.fn().mockResolvedValue({ createdAt: now, status: "FAILED" }),
    },
    errorEvent: {
      count: vi.fn().mockResolvedValue(3),
      findFirst: vi.fn().mockResolvedValue({ at: now, scope: "webhook", message: "boom" }),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("checkHealth", () => {
  it("summarizes token, last Meta call and errors without leaking values", async () => {
    const h = await checkHealth(fakeDb(), new Date("2026-08-25T12:00:00Z"));

    expect(h.db).toBe("ok");
    expect(h.ok).toBe(true);
    expect(h.token).toEqual({
      configured: true,
      daysLeft: 30,
      refreshedAt: "2026-08-25T12:00:00.000Z",
      needsAttention: false,
      lastRefreshFailed: false,
    });
    expect(h.lastMetaCall).toEqual({ at: "2026-08-25T12:00:00.000Z", ok: false });
    expect(h.errors24h).toEqual({
      count: 3,
      lastScope: "webhook",
      lastAt: "2026-08-25T12:00:00.000Z",
    });
    expect(JSON.stringify(h)).not.toContain("secret-token-value");
    expect(JSON.stringify(h)).not.toContain("boom");
  });

  it("reports the database down without touching anything else", async () => {
    const db = fakeDb({ dbDown: true });
    const h = await checkHealth(db);
    expect(h).toMatchObject({ ok: false, db: "down" });
    expect(db.message.findFirst).not.toHaveBeenCalled();
  });
});

describe("recordError", () => {
  it("persists scope, message and stack, and never throws", async () => {
    const db = fakeDb();
    await recordError(db, "webhook", new Error("x"), { entries: 2 });
    expect(vi.mocked(db.errorEvent.create).mock.calls[0][0].data).toMatchObject({
      scope: "webhook",
      message: "x",
      payload: { entries: 2 },
    });

    vi.mocked(db.errorEvent.create).mockRejectedValue(new Error("db down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordError(db, "drain", "plain string")).resolves.toBeUndefined();
    quiet.mockRestore();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * Guards the token lifecycle: refresh when close to expiring, leave it alone
 * when not, and never let a failed refresh take the tick down with it.
 */

const ORIGINAL = { ...process.env };
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-25T12:00:00Z");

type Row = {
  id: string;
  accessToken: string;
  expiresAt: Date | null;
  refreshedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
};

/** One-row table in memory, with the three Prisma calls the module makes. */
function fakeDb(initial: Partial<Row> | null) {
  let row: Row | null = initial
    ? {
        id: "default",
        accessToken: "old-token",
        expiresAt: null,
        refreshedAt: null,
        lastError: null,
        updatedAt: NOW,
        ...initial,
      }
    : null;

  const db = {
    igCredential: {
      findUnique: vi.fn(async () => (row ? { ...row } : null)),
      upsert: vi.fn(async ({ create }: { create: Partial<Row> }) => {
        row ??= {
          id: "default",
          accessToken: "",
          expiresAt: null,
          refreshedAt: null,
          lastError: null,
          updatedAt: NOW,
          ...create,
        };
        return { ...row };
      }),
      update: vi.fn(async ({ data }: { data: Partial<Row> }) => {
        if (!row) throw new Error("Record not found");
        row = { ...row, ...data };
        return { ...row };
      }),
    },
  } as unknown as PrismaClient;

  return { db, row: () => row };
}

function mockFetch(response: object, ok = true) {
  const spy = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 400, json: async () => response });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(async () => {
  delete process.env.IG_ACCESS_TOKEN;
  const { invalidateTokenCache } = await import("../token-refresh");
  invalidateTokenCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

describe("maybeRefreshToken", () => {
  it("refreshes when fewer than 10 days remain and stores the new token and expiry", async () => {
    const { db, row } = fakeDb({ expiresAt: new Date(NOW.getTime() + 5 * DAY) });
    const spy = mockFetch({ access_token: "new-token", token_type: "bearer", expires_in: 5184000 });
    const { maybeRefreshToken, getAccessToken } = await import("../token-refresh");

    const out = await maybeRefreshToken(db, NOW);

    expect(out.action).toBe("refreshed");
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("https://graph.instagram.com/refresh_access_token");
    expect(url).toContain("grant_type=ig_refresh_token");
    expect(url).toContain("access_token=old-token");

    expect(row()?.accessToken).toBe("new-token");
    expect(row()?.expiresAt).toEqual(new Date(NOW.getTime() + 5184000 * 1000));
    expect(row()?.refreshedAt).toEqual(NOW);
    expect(row()?.lastError).toBeNull();

    // The cache must not keep handing out the token that was just replaced.
    await expect(getAccessToken(db)).resolves.toBe("new-token");
  });

  it("does not call Meta when the token is far from expiring", async () => {
    const { db } = fakeDb({ expiresAt: new Date(NOW.getTime() + 30 * DAY) });
    const spy = mockFetch({ access_token: "unexpected" });
    const { maybeRefreshToken } = await import("../token-refresh");

    const out = await maybeRefreshToken(db, NOW);

    expect(out.action).toBe("skipped");
    expect(spy).not.toHaveBeenCalled();
  });

  it("seeds from the env when the table is empty and refreshes to learn the real expiry", async () => {
    process.env.IG_ACCESS_TOKEN = "env-token";
    const { db, row } = fakeDb(null);
    const spy = mockFetch({ access_token: "fresh", expires_in: 100 });
    const { maybeRefreshToken } = await import("../token-refresh");

    const out = await maybeRefreshToken(db, NOW);

    expect(out.action).toBe("refreshed");
    expect(String(spy.mock.calls[0][0])).toContain("access_token=env-token");
    expect(row()?.accessToken).toBe("fresh");
  });

  it("records a failed refresh in lastError, keeps the old token, and does not throw", async () => {
    const { db, row } = fakeDb({ expiresAt: new Date(NOW.getTime() + 2 * DAY) });
    mockFetch({ error: { message: "Token is too young to refresh" } }, false);
    const { maybeRefreshToken } = await import("../token-refresh");

    const out = await maybeRefreshToken(db, NOW);

    expect(out).toEqual({ action: "failed", error: "Token is too young to refresh" });
    expect(row()?.accessToken).toBe("old-token");
    expect(row()?.lastError).toBe("Token is too young to refresh");
  });

  it("survives a network failure the same way", async () => {
    const { db, row } = fakeDb({ expiresAt: null });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const { maybeRefreshToken } = await import("../token-refresh");

    await expect(maybeRefreshToken(db, NOW)).resolves.toEqual({ action: "failed", error: "ECONNRESET" });
    expect(row()?.lastError).toBe("ECONNRESET");
  });

  it("reports unconfigured when there is no token anywhere", async () => {
    const { db } = fakeDb(null);
    const spy = mockFetch({});
    const { maybeRefreshToken } = await import("../token-refresh");

    await expect(maybeRefreshToken(db, NOW)).resolves.toEqual({ action: "unconfigured" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("getAccessToken", () => {
  it("prefers the stored token over the env", async () => {
    process.env.IG_ACCESS_TOKEN = "env-token";
    const { db } = fakeDb({ accessToken: "db-token", refreshedAt: NOW });
    const { getAccessToken } = await import("../token-refresh");

    await expect(getAccessToken(db)).resolves.toBe("db-token");
  });

  it("adopts a rotated env token when the last refresh failed", async () => {
    process.env.IG_ACCESS_TOKEN = "rotated-by-hand";
    const { db, row } = fakeDb({ accessToken: "dead", refreshedAt: NOW, lastError: "expired" });
    const { getAccessToken } = await import("../token-refresh");

    await expect(getAccessToken(db)).resolves.toBe("rotated-by-hand");
    expect(row()?.lastError).toBeNull();
    expect(row()?.expiresAt).toBeNull();
  });

  it("falls back to the env when the database cannot be read", async () => {
    process.env.IG_ACCESS_TOKEN = "env-token";
    const db = {
      igCredential: { findUnique: vi.fn().mockRejectedValue(new Error("db down")) },
    } as unknown as PrismaClient;
    const { getAccessToken } = await import("../token-refresh");

    await expect(getAccessToken(db)).resolves.toBe("env-token");
  });

  it("throws the same error as before when no token exists", async () => {
    const { db } = fakeDb(null);
    const { getAccessToken } = await import("../token-refresh");

    await expect(getAccessToken(db)).rejects.toThrow(/IG_ACCESS_TOKEN/);
  });
});

describe("tokenStatus", () => {
  it("needs attention under 7 days or after a failed refresh, not otherwise", async () => {
    const { tokenStatus } = await import("../token-refresh");

    const fine = await tokenStatus(fakeDb({ expiresAt: new Date(NOW.getTime() + 20 * DAY) }).db, NOW);
    expect(fine).toMatchObject({ configured: true, daysLeft: 20, needsAttention: false });

    const soon = await tokenStatus(fakeDb({ expiresAt: new Date(NOW.getTime() + 3 * DAY) }).db, NOW);
    expect(soon).toMatchObject({ daysLeft: 3, needsAttention: true });

    const broken = await tokenStatus(fakeDb({ lastError: "boom" }).db, NOW);
    expect(broken).toMatchObject({ daysLeft: null, lastError: "boom", needsAttention: true });

    const none = await tokenStatus(fakeDb(null).db, NOW);
    expect(none).toMatchObject({ configured: false, needsAttention: false });
  });
});

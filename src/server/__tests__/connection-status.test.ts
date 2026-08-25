import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { connectionStatus, summarizeConnection } from "../connection-status";

const NOW = new Date("2026-08-25T12:00:00Z");
const token = {
  configured: true,
  expiresAt: null,
  refreshedAt: null,
  lastError: null,
  daysLeft: 40,
  needsAttention: false,
};

describe("summarizeConnection", () => {
  it("is green with a healthy token and a successful last call", () => {
    const s = summarizeConnection(
      { token, lastMetaCall: { at: new Date(NOW.getTime() - 5 * 60_000), ok: true }, errors24h: 0 },
      NOW,
    );
    expect(s.level).toBe("ok");
    expect(s.detail).toEqual([
      "Última chamada à Meta há 5 min, ok.",
      "Token válido por 40 dia(s).",
    ]);
  });

  it("is red without a token, on a failed refresh, or when expired", () => {
    expect(
      summarizeConnection({
        token: { ...token, configured: false },
        lastMetaCall: null,
        errors24h: 0,
      }).level,
    ).toBe("down");
    expect(
      summarizeConnection({ token: { ...token, lastError: "x" }, lastMetaCall: null, errors24h: 0 })
        .level,
    ).toBe("down");
    expect(
      summarizeConnection({ token: { ...token, daysLeft: -1 }, lastMetaCall: null, errors24h: 0 })
        .level,
    ).toBe("down");
  });

  it("is amber when the token is close to expiry, the last call failed, or errors landed", () => {
    const s = summarizeConnection(
      { token: { ...token, daysLeft: 3 }, lastMetaCall: { at: NOW, ok: false }, errors24h: 2 },
      NOW,
    );
    expect(s.level).toBe("warn");
    expect(s.detail).toEqual([
      "O token expira em 3 dia(s).",
      "A última chamada à Meta falhou.",
      "2 erro(s) nas últimas 24h.",
    ]);
  });
});

describe("connectionStatus", () => {
  it("never throws: a dead database is reported as down", async () => {
    const db = {
      igCredential: { findUnique: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) },
      message: { findFirst: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) },
      errorEvent: { count: vi.fn().mockRejectedValue(new Error("x")), findFirst: vi.fn() },
    } as unknown as PrismaClient;
    const s = await connectionStatus(db);
    expect(s.level).toBe("down");
  });
});

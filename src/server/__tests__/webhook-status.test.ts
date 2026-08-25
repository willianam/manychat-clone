import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WEBHOOK_FIELDS, webhookStatus } from "../webhook-status";

describe("webhookStatus", () => {
  it("lists the last arrival per kind, newest first, and the 24h totals", async () => {
    const older = new Date("2026-08-24T10:00:00Z");
    const newer = new Date("2026-08-25T10:00:00Z");
    const db = {
      webhookEvent: {
        groupBy: vi.fn().mockResolvedValue([
          { kind: "message", _max: { receivedAt: older }, _count: { _all: 40 } },
          { kind: "read", _max: { receivedAt: newer }, _count: { _all: 3 } },
          { kind: "comment", _max: { receivedAt: null }, _count: { _all: 0 } },
        ]),
        count: vi.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(1),
      },
    } as unknown as PrismaClient;

    const s = await webhookStatus(db, new Date("2026-08-25T12:00:00Z"));
    expect(s.lastByKind.map((k) => k.kind)).toEqual(["read", "message"]);
    expect(s.lastByKind[0]).toEqual({ kind: "read", lastAt: newer, count: 3 });
    expect(s.received24h).toBe(12);
    expect(s.failed24h).toBe(1);
  });

  it("every expected field maps to at least one event kind", () => {
    for (const f of WEBHOOK_FIELDS) expect(f.kinds.length).toBeGreaterThan(0);
  });
});

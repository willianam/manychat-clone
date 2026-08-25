import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  purgeOldDiagnostics,
  WEBHOOK_RETENTION_DAYS,
  WEBHOOK_FAILED_RETENTION_DAYS,
  ERROR_RETENTION_DAYS,
} from "../retention";

const NOW = new Date("2026-08-25T12:00:00Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function fakeDb() {
  const webhookDelete = vi.fn().mockResolvedValue({ count: 3 });
  const errorDelete = vi.fn().mockResolvedValue({ count: 2 });
  const db = {
    webhookEvent: { deleteMany: webhookDelete },
    errorEvent: { deleteMany: errorDelete },
  } as unknown as PrismaClient;
  return { db, webhookDelete, errorDelete };
}

describe("purgeOldDiagnostics", () => {
  it("expires processed webhooks sooner than failed ones", async () => {
    const { db, webhookDelete } = fakeDb();
    await purgeOldDiagnostics(db, NOW);

    const [processed, failed] = webhookDelete.mock.calls.map((c) => c[0].where);
    expect(processed.processedAt).toEqual({ not: null });
    expect(processed.receivedAt.lt).toEqual(daysBefore(WEBHOOK_RETENTION_DAYS));

    // A webhook that never ran is the only record of it: kept longer.
    expect(failed.processedAt).toBeNull();
    expect(failed.receivedAt.lt).toEqual(daysBefore(WEBHOOK_FAILED_RETENTION_DAYS));
    expect(failed.receivedAt.lt.getTime()).toBeLessThan(processed.receivedAt.lt.getTime());
  });

  it("expires error events on their own window", async () => {
    const { db, errorDelete } = fakeDb();
    await purgeOldDiagnostics(db, NOW);
    expect(errorDelete.mock.calls[0]![0].where.at.lt).toEqual(daysBefore(ERROR_RETENTION_DAYS));
  });

  it("reports how much it removed", async () => {
    const { db } = fakeDb();
    // Two webhook deletes at 3 each, one error delete at 2.
    expect(await purgeOldDiagnostics(db, NOW)).toEqual({ webhookEvents: 6, errorEvents: 2 });
  });
});

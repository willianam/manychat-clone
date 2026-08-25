import type { PrismaClient } from "@prisma/client";

/**
 * Retention for the two diagnostic tables.
 *
 * WebhookEvent keeps the RAW payload Meta sent (message text included) and
 * ErrorEvent keeps a stack plus the payload that caused it. Both exist to
 * debug the last few days, not to be a second copy of the conversation
 * history — and the privacy policy promises we do not hold data longer than
 * it is useful. Nothing expired them, so both grew without bound.
 *
 * A processed webhook is worth keeping only briefly. A FAILED one is kept
 * longer, because it is the only record of something that never ran.
 */

export const WEBHOOK_RETENTION_DAYS = 7;
export const WEBHOOK_FAILED_RETENTION_DAYS = 30;
export const ERROR_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * DAY_MS);

export type PurgeResult = {
  webhookEvents: number;
  errorEvents: number;
};

/** Deletes expired diagnostic rows. Safe to run repeatedly. */
export async function purgeOldDiagnostics(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<PurgeResult> {
  const [processed, failed, errors] = await Promise.all([
    // Handled cleanly: the raw payload has done its job.
    db.webhookEvent.deleteMany({
      where: {
        processedAt: { not: null },
        receivedAt: { lt: daysAgo(WEBHOOK_RETENTION_DAYS, now) },
      },
    }),
    // Never processed: kept longer, but not forever.
    db.webhookEvent.deleteMany({
      where: {
        processedAt: null,
        receivedAt: { lt: daysAgo(WEBHOOK_FAILED_RETENTION_DAYS, now) },
      },
    }),
    db.errorEvent.deleteMany({ where: { at: { lt: daysAgo(ERROR_RETENTION_DAYS, now) } } }),
  ]);

  return {
    webhookEvents: processed.count + failed.count,
    errorEvents: errors.count,
  };
}

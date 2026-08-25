import type { PrismaClient } from "@prisma/client";
import { logger } from "../lib/log";

const log = logger("errors");

/**
 * Persisted errors, so /api/health and the panel can answer "did anything
 * break in the last 24h" without grepping host logs.
 *
 * Never throws: it is called from catch blocks, and a second failure there
 * would mask the first. `payload` is whatever context the caller thinks
 * will help — keep it small; the raw webhook already lives in WebhookEvent.
 */
export async function recordError(
  db: PrismaClient,
  scope: string,
  err: unknown,
  payload?: Record<string, unknown>,
): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  try {
    await db.errorEvent.create({
      data: {
        scope,
        message: e.message.slice(0, 2000),
        stack: e.stack?.slice(0, 8000),
        payload: payload as never,
      },
    });
  } catch (inner) {
    log.error("could not persist error event", { scope, original: e, inner });
  }
}

/** How many errors landed since `since`, and the most recent one's scope. */
export async function errorSummary(
  db: PrismaClient,
  since: Date,
): Promise<{ count: number; last: { at: Date; scope: string; message: string } | null }> {
  const [count, last] = await Promise.all([
    db.errorEvent.count({ where: { at: { gte: since } } }),
    db.errorEvent.findFirst({
      orderBy: { at: "desc" },
      select: { at: true, scope: true, message: true },
    }),
  ]);
  return { count, last };
}

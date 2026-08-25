import { db } from "./db";
import { runBroadcast, tickDelayedSessions, sweepStaleSessions } from "./broadcast-worker";
import { maybeRefreshToken } from "./token-refresh";
import { rollupRecent } from "./rollup";
import { recordError } from "./error-events";
import { reprocessFailed } from "./webhook-events";
import { logger } from "../lib/log";

const log = logger("worker");

/**
 * Background loop: resumes delayed flow sessions and drains queued
 * broadcasts. Deliberately sequential — concurrency here would race the
 * per-send rate limiter and get the app throttled.
 */

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 5000);
/** The token check is cheap but a failing refresh must not hit Meta every 5s. */
const TOKEN_CHECK_MS = 60 * 60 * 1000;
/** Daily aggregates are cheap but not free; once a minute is plenty. */
const ROLLUP_MS = 60 * 1000;
let stopping = false;
let lastTokenCheck = 0;
let lastRollup = 0;

async function tick(): Promise<void> {
  if (Date.now() - lastTokenCheck >= TOKEN_CHECK_MS) {
    lastTokenCheck = Date.now();
    const token = await maybeRefreshToken(db);
    if (token.action === "refreshed") {
      log.info("Instagram token refreshed", { expiresAt: token.expiresAt.toISOString() });
    } else if (token.action === "failed") {
      log.warn("Instagram token refresh failed", { error: token.error });
    }
  }

  const resumed = await tickDelayedSessions(db);
  if (resumed) log.info("resumed delayed sessions", { resumed });

  const swept = await sweepStaleSessions(db);
  if (swept) log.info("abandoned stale sessions", { swept });

  const queued = await db.broadcast.findMany({
    where: { status: "QUEUED", OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
    take: 1,
  });

  for (const b of queued) {
    log.info("sending broadcast", { broadcast: b.name });
    const report = await runBroadcast(db, b.id);
    if (!report.claimed) continue; // another drainer has it
    log.info("broadcast finished", { broadcast: b.name, ...report });
  }

  if (Date.now() - lastRollup >= ROLLUP_MS) {
    lastRollup = Date.now();
    const { retried, recovered } = await reprocessFailed(db);
    if (retried) log.info("reprocessed failed webhook events", { retried, recovered });
    await rollupRecent(db);
  }
}

async function main(): Promise<void> {
  log.info("started", { tickMs: TICK_MS });

  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      // A bad tick must not kill the loop — log and keep going.
      log.error("tick failed", { err });
      await recordError(db, "worker", err);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }

  await db.$disconnect();
  log.info("stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("signal received, finishing current tick", { signal: sig });
    stopping = true;
  });
}

main().catch((err) => {
  log.error("fatal", { err });
  process.exit(1);
});

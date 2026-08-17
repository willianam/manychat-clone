import { db } from "./db";
import { runBroadcast, tickDelayedSessions } from "./broadcast-worker";

/**
 * Background loop: resumes delayed flow sessions and drains queued
 * broadcasts. Deliberately sequential — concurrency here would race the
 * per-send rate limiter and get the app throttled.
 */

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 5000);
let stopping = false;

async function tick(): Promise<void> {
  const resumed = await tickDelayedSessions(db);
  if (resumed) console.log(`[worker] resumed ${resumed} delayed session(s)`);

  const queued = await db.broadcast.findMany({
    where: { status: "QUEUED", OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
    take: 1,
  });

  for (const b of queued) {
    console.log(`[worker] sending broadcast "${b.name}"`);
    const report = await runBroadcast(db, b.id);
    console.log(
      `[worker] "${b.name}": ${report.sent} sent, ${report.skipped} skipped (window), ${report.failed} failed`,
    );
  }
}

async function main(): Promise<void> {
  console.log(`[worker] started, tick=${TICK_MS}ms`);

  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      // A bad tick must not kill the loop — log and keep going.
      console.error("[worker] tick failed:", err);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }

  await db.$disconnect();
  console.log("[worker] stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} — finishing current tick`);
    stopping = true;
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});

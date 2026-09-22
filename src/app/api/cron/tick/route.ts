import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../server/db";
import {
  runBroadcast,
  CRON_DRAIN_BUDGET_MS,
  tickDelayedSessions,
  sweepStaleSessions,
} from "../../../../server/broadcast-worker";
import { maybeRefreshToken } from "../../../../server/token-refresh";
import { rollupRecent } from "../../../../server/rollup";
import { reprocessFailed } from "../../../../server/webhook-events";
import { purgeOldDiagnostics } from "../../../../server/retention";
import { constantTimeEqual } from "../../../../lib/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby caps at 60s

/**
 * Serverless replacement for worker-entry.ts.
 *
 * Vercel functions can't hold a loop, so the same jobs — refreshing the
 * token, resuming delayed sessions, sweeping stale ones, draining a
 * broadcast — run once per invocation. Vercel Cron calls this ONCE A DAY
 * (`0 9 * * *` in vercel.json; the Hobby plan allows no more), so this is
 * the floor for an idle account, not the main path. The main path is
 * drainDueWork() in the webhook route, which runs the same jobs on every
 * inbound message. Short delays that must resume on time need the worker
 * (`bun run worker`) on a machine that can hold a loop.
 *
 * Because a run is capped at 60s, one tick sends at most what the rate
 * limiter allows in that window; the rest is picked up by the next call.
 * That's why runBroadcast is safe to re-enter: it only ever reads PENDING
 * rows.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 503 });
  }

  // Header only. A `?secret=` fallback used to exist for manual curls, but a
  // secret in a query string is written to the Vercel access log, to every
  // proxy in between and to the shell history — read the log once and you own
  // the endpoint that sends real messages. Use:
  //   curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/tick
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !(await constantTimeEqual(auth.slice(7), secret))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Token first: if it is about to expire, nothing below can send anyway.
  const token = await maybeRefreshToken(db);

  const resumed = await tickDelayedSessions(db);
  const swept = await sweepStaleSessions(db);

  const queued = await db.broadcast.findMany({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
    },
    take: 1,
  });

  let broadcast: {
    name: string;
    sent: number;
    skipped: number;
    failed: number;
    stopped: string;
    remaining: number;
  } | null = null;
  if (queued[0]) {
    const r = await runBroadcast(db, queued[0].id, { budgetMs: CRON_DRAIN_BUDGET_MS });
    broadcast = { name: queued[0].name, ...r };
  }

  // Webhook events whose handler failed inline get one more run.
  const reprocessed = await reprocessFailed(db);

  // Daily aggregates last: they read what the jobs above just wrote.
  const rolled = await rollupRecent(db);

  // Raw webhook payloads and error stacks expire; see server/retention.ts.
  const purged = await purgeOldDiagnostics(db);

  return NextResponse.json({
    ok: true,
    token: token.action,
    resumed,
    swept,
    broadcast,
    reprocessed,
    rolled,
    purged,
  });
}

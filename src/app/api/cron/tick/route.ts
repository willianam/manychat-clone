import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../server/db";
import { runBroadcast, tickDelayedSessions } from "../../../../server/broadcast-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby caps at 60s

/**
 * Serverless replacement for worker-entry.ts.
 *
 * Vercel functions can't hold a loop, so the same two jobs — resuming
 * delayed sessions and draining broadcasts — run once per invocation and
 * Vercel Cron calls this on a schedule (see vercel.json).
 *
 * Because a run is capped at 60s, one tick sends at most what the rate
 * limiter allows in that window; the rest is picked up next minute. That's
 * why runBroadcast is safe to re-enter: it only ever reads PENDING rows.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 503 });
  }

  // Vercel Cron sends this header; a manual curl can pass ?secret=.
  const auth = req.headers.get("authorization");
  const qs = req.nextUrl.searchParams.get("secret");
  if (auth !== `Bearer ${secret}` && qs !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const resumed = await tickDelayedSessions(db);

  const queued = await db.broadcast.findMany({
    where: {
      status: { in: ["QUEUED", "SENDING"] },
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
    },
    take: 1,
  });

  let broadcast: { name: string; sent: number; skipped: number; failed: number } | null = null;
  if (queued[0]) {
    const r = await runBroadcast(db, queued[0].id);
    broadcast = { name: queued[0].name, ...r };
  }

  return NextResponse.json({ ok: true, resumed, broadcast });
}

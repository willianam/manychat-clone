import type { PrismaClient } from "@prisma/client";
import { sendText, SendBlocked } from "./instagram";
import { canSend } from "../lib/messaging-window";

/**
 * Broadcast sender.
 *
 * Two constraints shape this:
 *
 * 1. Rate limit. Instagram messaging is metered per-app and bursting gets
 *    you throttled (error 613) or flagged. We pace sends with a token
 *    interval rather than firing a Promise.all over ten thousand rows.
 *
 * 2. The 24h window. Most of a contact list is outside it at any moment.
 *    We filter those out up front and mark them FAILED with a clear reason,
 *    so the report distinguishes "we couldn't" from "it broke".
 */

const SENDS_PER_SECOND = Number(process.env.BROADCAST_RATE ?? 5);
const INTERVAL_MS = Math.ceil(1000 / SENDS_PER_SECOND);

export async function enqueueBroadcast(db: PrismaClient, broadcastId: string): Promise<number> {
  const b = await db.broadcast.findUniqueOrThrow({ where: { id: broadcastId } });

  const contacts = await db.contact.findMany({
    where: {
      subscribed: true,
      ...(b.filterTagIds.length
        ? { tags: { some: { tagId: { in: b.filterTagIds } } } }
        : {}),
    },
    select: { id: true },
  });

  if (contacts.length === 0) {
    await db.broadcast.update({ where: { id: b.id }, data: { status: "DONE" } });
    return 0;
  }

  await db.broadcastRecipient.createMany({
    data: contacts.map((c) => ({ broadcastId: b.id, contactId: c.id })),
    skipDuplicates: true,
  });

  await db.broadcast.update({ where: { id: b.id }, data: { status: "QUEUED" } });
  return contacts.length;
}

export type BroadcastReport = { sent: number; skipped: number; failed: number };

export async function runBroadcast(
  db: PrismaClient,
  broadcastId: string,
): Promise<BroadcastReport> {
  const b = await db.broadcast.findUniqueOrThrow({ where: { id: broadcastId } });
  await db.broadcast.update({ where: { id: b.id }, data: { status: "SENDING" } });

  const pending = await db.broadcastRecipient.findMany({
    where: { broadcastId: b.id, status: "PENDING" },
    include: { contact: true },
  });

  const report: BroadcastReport = { sent: 0, skipped: 0, failed: 0 };

  for (const r of pending) {
    const decision = canSend(r.contact.lastInboundAt);
    if (!decision.allowed) {
      await db.broadcastRecipient.update({
        where: { id: r.id },
        data: { status: "FAILED", error: decision.reason },
      });
      report.skipped++;
      continue;
    }

    try {
      await sendText(db, r.contactId, b.text);
      await db.broadcastRecipient.update({
        where: { id: r.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      report.sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.broadcastRecipient.update({
        where: { id: r.id },
        data: { status: "FAILED", error: msg },
      });
      if (err instanceof SendBlocked) report.skipped++;
      else report.failed++;
    }

    await sleep(INTERVAL_MS);
  }

  await db.broadcast.update({
    where: { id: b.id },
    data: { status: report.failed > 0 && report.sent === 0 ? "FAILED" : "DONE" },
  });

  return report;
}

/**
 * Resumes sessions parked on a delay node. Run on an interval (cron, or a
 * setInterval in dev — see docker/worker.ts).
 */
export async function tickDelayedSessions(db: PrismaClient): Promise<number> {
  const due = await db.flowSession.findMany({
    where: { status: "ACTIVE", resumeAt: { lte: new Date() } },
    take: 100,
  });

  const { startFlow } = await import("./flow-runner");
  let resumed = 0;

  for (const s of due) {
    await db.flowSession.update({ where: { id: s.id }, data: { resumeAt: null } });
    await startFlow(db, s.flowId, s.contactId).catch(() => {});
    resumed++;
  }

  return resumed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

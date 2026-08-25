import type { PrismaClient } from "@prisma/client";
import { sendText, SendBlocked } from "./instagram";
import { canSend, WINDOW_MS } from "../lib/messaging-window";

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

/**
 * Materialize the recipient rows for a broadcast.
 *
 * `window` narrows the audience the same way the compose-time preview does,
 * so the count the owner approved is the count actually enqueued. It is a
 * call-time argument rather than a stored column because the window is
 * time-dependent: persisting "in window" and enqueueing an hour later would
 * store a selection that is already wrong.
 */
export async function enqueueBroadcast(
  db: PrismaClient,
  broadcastId: string,
  opts: { window?: "in" | "out" } = {},
): Promise<number> {
  const b = await db.broadcast.findUniqueOrThrow({ where: { id: broadcastId } });

  const contacts = await db.contact.findMany({
    where: audienceWhere({ tagIds: b.filterTagIds, window: opts.window }),
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

/**
 * Who would actually receive this broadcast if it went out right now.
 *
 * `runBroadcast` already skips contacts outside the 24h window, but it does
 * so while sending — the owner discovers that 900 of 1000 recipients were
 * unreachable only in the report, after the broadcast is spent. This answers
 * the same question BEFORE, at compose time.
 *
 * `inWindow` is a snapshot: the window keeps closing as time passes, so a
 * broadcast composed now and sent in an hour will reach fewer people. That
 * is why the number is labelled "agora" in the UI.
 */
export type WindowPreview = {
  total: number;
  inWindow: number;
  outOfWindow: number;
  /** True when most of the audience cannot be reached — worth a loud warning. */
  mostlyOutOfWindow: boolean;
};

export type AudienceFilter = {
  tagIds?: string[];
  /** Restrict to contacts inside / outside the window. Undefined = both. */
  window?: "in" | "out";
};

/** Prisma `where` for an audience selection. Shared so the preview counts
 *  exactly the rows the send will later walk. */
export function audienceWhere(filter: AudienceFilter, now = new Date()) {
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  return {
    subscribed: true,
    ...(filter.tagIds?.length ? { tags: { some: { tagId: { in: filter.tagIds } } } } : {}),
    ...(filter.window === "in" ? { lastInboundAt: { gt: cutoff } } : {}),
    // Outside the window includes contacts who never wrote at all (null).
    ...(filter.window === "out"
      ? { OR: [{ lastInboundAt: null }, { lastInboundAt: { lte: cutoff } }] }
      : {}),
  };
}

/** Count how much of a prospective audience is reachable right now. */
export async function previewAudience(
  db: PrismaClient,
  filter: AudienceFilter = {},
  now = new Date(),
): Promise<WindowPreview> {
  // Ignore any window restriction for the totals — the preview's job is to
  // report the split, so it must look at the whole tag-selected audience.
  const base = audienceWhere({ tagIds: filter.tagIds }, now);

  const [total, inWindow] = await Promise.all([
    db.contact.count({ where: base }),
    db.contact.count({
      where: audienceWhere({ tagIds: filter.tagIds, window: "in" }, now),
    }),
  ]);

  const outOfWindow = total - inWindow;
  return {
    total,
    inWindow,
    outOfWindow,
    mostlyOutOfWindow: total > 0 && inWindow * 2 < total,
  };
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
 *
 * WAITING_INPUT is included because a delay that also listens for a reply
 * (untilReply with a timeout, or a cancellable fixed wait) parks the session
 * as waiting; its `resumeAt` is the timeout.
 */
export async function tickDelayedSessions(db: PrismaClient): Promise<number> {
  const due = await db.flowSession.findMany({
    where: { status: { in: ["ACTIVE", "WAITING_INPUT"] }, resumeAt: { lte: new Date() } },
    take: 100,
  });

  const { resumeDelayed } = await import("./flow-runner");
  let resumed = 0;

  for (const s of due) {
    await db.flowSession.update({ where: { id: s.id }, data: { resumeAt: null } });
    await resumeDelayed(db, s).catch((err) => {
      console.warn(`[worker] delayed session ${s.id} failed to resume:`, err);
    });
    resumed++;
  }

  return resumed;
}

/** A question nobody answered for this long is over. */
export const STALE_SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * Sister of tickDelayedSessions: sessions parked on a question with no
 * answer for 24h are marked ABANDONED. Without this a contact who walked
 * away mid-flow stays "waiting" forever, and whatever they type next week is
 * taken as the answer to a question they no longer remember.
 *
 * Runs on the same schedule as the delay resumer. Returns how many it swept.
 */
export async function sweepStaleSessions(db: PrismaClient, now = new Date()): Promise<number> {
  const { count } = await db.flowSession.updateMany({
    where: {
      status: "WAITING_INPUT",
      // A waiting session with a resumeAt is a delay with its own deadline.
      resumeAt: null,
      updatedAt: { lt: new Date(now.getTime() - STALE_SESSION_MS) },
    },
    data: { status: "ABANDONED" },
  });
  return count;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

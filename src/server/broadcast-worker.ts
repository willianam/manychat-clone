import type { PrismaClient } from "@prisma/client";
import { sendMessage, SendBlocked } from "./instagram";
import { parseBroadcastBody, type BroadcastBody } from "../lib/broadcast-content";
import { broadcastPayload } from "./broadcast-payload";
import { canSend, WINDOW_MS } from "../lib/messaging-window";
import {
  parseSegmentRules,
  segmentWhere,
  filterSegment,
  needsFilter,
  SEGMENT_CONTACT_SELECT,
} from "./segments";
import type { SegmentRules } from "../lib/segment-rules";

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
  const b = await db.broadcast.findUniqueOrThrow({
    where: { id: broadcastId },
    include: { segment: true },
  });

  const contacts = await resolveAudience(db, { ...audienceOf(b), window: opts.window });

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
  /** A saved segment's rules. When present, `tagIds` is ignored. */
  rules?: SegmentRules;
  /** Restrict to contacts inside / outside the window. Undefined = both. */
  window?: "in" | "out";
};

/**
 * The audience a broadcast row describes: its segment when it has one,
 * otherwise its tag filter. Segments win because they can say everything
 * tags can and more, and combining the two would mean two sets of rules
 * for one send.
 */
export function audienceOf(b: {
  filterTagIds: string[];
  segment?: { rules: unknown } | null;
}): AudienceFilter {
  if (b.segment) return { rules: parseSegmentRules(b.segment.rules) };
  return { tagIds: b.filterTagIds };
}

/** Prisma `where` for an audience selection. Shared so the preview counts
 *  exactly the rows the send will later walk. */
export function audienceWhere(filter: AudienceFilter, now = new Date()) {
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  return {
    subscribed: true,
    ...(filter.rules ? segmentWhere(filter.rules) : {}),
    ...(!filter.rules && filter.tagIds?.length
      ? { tags: { some: { tagId: { in: filter.tagIds } } } }
      : {}),
    ...(filter.window === "in" ? { lastInboundAt: { gt: cutoff } } : {}),
    // Outside the window includes contacts who never wrote at all (null).
    ...(filter.window === "out"
      ? { OR: [{ lastInboundAt: null }, { lastInboundAt: { lte: cutoff } }] }
      : {}),
  };
}

/**
 * The contacts an audience filter selects right now.
 *
 * A segment may carry rules Postgres cannot evaluate (see segments.ts), so
 * the rows are fetched with what the in-memory pass needs and filtered
 * once more. Tag-only audiences pay nothing extra: the filter is a no-op.
 */
export async function resolveAudience(db: PrismaClient, filter: AudienceFilter, now = new Date()) {
  const rows = await db.contact.findMany({
    where: audienceWhere(filter, now),
    select: SEGMENT_CONTACT_SELECT,
  });
  return filter.rules ? filterSegment(rows, filter.rules, now) : rows;
}

/** Count how much of a prospective audience is reachable right now. */
export async function previewAudience(
  db: PrismaClient,
  filter: AudienceFilter = {},
  now = new Date(),
): Promise<WindowPreview> {
  // Ignore any window restriction for the totals — the preview's job is to
  // report the split, so it must look at the whole selected audience.
  const base: AudienceFilter = { tagIds: filter.tagIds, rules: filter.rules };

  let total: number;
  let inWindow: number;
  if (filter.rules && needsFilter(filter.rules)) {
    // Counting in the database would miss the in-memory rules; walk the rows.
    const rows = await resolveAudience(db, base, now);
    total = rows.length;
    inWindow = rows.filter((c) => canSend(c.lastInboundAt, { now }).allowed).length;
  } else {
    [total, inWindow] = await Promise.all([
      db.contact.count({ where: audienceWhere(base, now) }),
      db.contact.count({ where: audienceWhere({ ...base, window: "in" }, now) }),
    ]);
  }

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
  const body = parseBroadcastBody(b);

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
      await deliver(db, b.id, body, r.contactId);
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
 * One recipient's delivery, by body kind.
 *
 * "Send a flow" starts the flow for the contact; `startFlow` returning null
 * means the flow is disabled or the contact opted out, which is a failure
 * worth a reason in the report rather than a silent skip.
 */
async function deliver(
  db: PrismaClient,
  broadcastId: string,
  body: BroadcastBody,
  contactId: string,
): Promise<void> {
  if (body.kind === "flow") {
    const { startFlow } = await import("./flow-runner");
    const result = await startFlow(db, body.flowId, contactId);
    if (!result) throw new Error("Fluxo desativado ou contato descadastrado.");
    return;
  }
  if (body.kind === "content") {
    const { payload, preview } = broadcastPayload(broadcastId, body.content);
    await sendMessage(db, contactId, payload, { preview });
    return;
  }
  await sendMessage(db, contactId, { text: body.text }, { preview: body.text });
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
      updatedAt: { lt: new Date(now.getTime() - STALE_SESSION_MS) },
    },
    data: { status: "ABANDONED" },
  });
  return count;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

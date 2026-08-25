import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../server/db";
import { verifySignature, verifyChallenge } from "../../../../lib/verify-signature";
import {
  handleInboundMessage,
  handleComment,
  handlePostback,
  handleStoryReply,
  handleStoryMention,
  handleRefLink,
  handleProfilePostback,
} from "../../../../server/trigger-dispatch";
import { fetchProfile } from "../../../../server/instagram";
import { recordInboundMessage } from "../../../../server/inbound-attachments";
import {
  parseStoryReply,
  parseStoryMention,
  parseReferral,
  parseReadReceipt,
  parseDelivery,
  normalizeRefCode,
  type MessagingEvent,
} from "../../../../lib/entry-events";
import { applyReadReceipt, applyDelivery } from "../../../../server/receipts";
import { rollupRecent } from "../../../../server/rollup";
import { recordError } from "../../../../server/error-events";
import { logger } from "../../../../lib/log";

const log = logger("webhook");
import { parseFlowPayload } from "../../../../lib/messenger-profile";
import {
  tickDelayedSessions,
  sweepStaleSessions,
  runBroadcast,
} from "../../../../server/broadcast-worker";

export const runtime = "nodejs"; // crypto + Prisma need Node, not Edge
export const dynamic = "force-dynamic";
/** Meta retries past ~20s; stay under it. */
export const maxDuration = 15;

/** Meta's subscription handshake. */
export async function GET(req: NextRequest) {
  const challenge = verifyChallenge(req.nextUrl.searchParams, process.env.IG_VERIFY_TOKEN ?? "");
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(req: NextRequest) {
  // Raw body first — parsing then re-serializing breaks the HMAC.
  const raw = await req.text();

  if (
    !verifySignature(raw, req.headers.get("x-hub-signature-256"), process.env.IG_APP_SECRET ?? "")
  ) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(raw) as MetaWebhook;

  // Must finish BEFORE responding. A serverless function is frozen the
  // moment its response is sent, so fire-and-forget work is simply dropped
  // — the handler would 200 and silently do nothing.
  //
  // Meta retries anything slower than ~20s. That is the real budget here:
  // processPayload sends at most a few messages, and the WebhookEvent table
  // makes a retry idempotent if we ever do overrun.
  try {
    await processPayload(payload);
    await drainDueWork();
  } catch (err) {
    // Still ack: a 500 makes Meta retry a delivery we may have half-applied.
    log.error("processing failed", { err });
    await recordError(db, "webhook", err, { entries: payload.entry?.length ?? 0 });
  }

  return NextResponse.json({ received: true });
}

async function processPayload(payload: MetaWebhook): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      // Receipts carry no message and no referral; they only move statuses.
      if (await processReceipt(event)) continue;

      // A ref can ride along on a message, a postback, or its own event, and
      // in the first two cases the message below still needs handling. So
      // referrals are resolved first and their outcome decides whether the
      // ordinary paths should also run: a link that started a flow must not
      // then have the same message start a second one.
      const refHandled = await processReferral(event);

      // Story replies and mentions arrive on the `messages` field too, but
      // route differently, so they are claimed before the plain-text path.
      if (await processStoryEvent(event, refHandled)) continue;

      // Media-only messages have no text. Dropping them on `!text` is what
      // silently lost every photo and audio note the account ever received.
      const hasAttachments = Boolean(event.message?.attachments?.length);
      if (!event.message || event.message.is_echo) continue;
      if (!event.message.text && !hasAttachments) continue;

      const mid = event.message.mid;
      if (mid && (await seen(mid, "message", event))) continue;

      const igsid = event.sender.id;

      const profile = await fetchProfile(igsid);

      const contact = await db.contact.upsert({
        where: { igScopedId: igsid },
        create: { igScopedId: igsid, lastInboundAt: new Date(), source: "dm", ...profile },
        update: { lastInboundAt: new Date(), ...profile },
      });

      // Persists attachments with their expiry: Meta's media URLs die after
      // 7 days, so the record is the only trace that survives.
      await recordInboundMessage(db, {
        contactId: contact.id,
        mid,
        text: event.message.text,
        attachments: event.message.attachments,
      });

      // The ref link already picked the flow for this first message; running
      // the keyword path too would start a second, competing flow.
      if (refHandled) continue;

      if (event.message.text) {
        await handleInboundMessage(db, contact.id, event.message.text);
      }
    }

    // Button and quick-reply taps arrive as postbacks, a separate event from
    // messages. Without this branch a tapped button does nothing at all.
    for (const event of entry.messaging ?? []) {
      const pb = event.postback ?? event.message?.quick_reply;
      if (!pb?.payload) continue;

      const dedupId = event.postback?.mid ?? `qr:${event.message?.mid ?? ""}`;
      if (dedupId && (await seen(dedupId, "postback", event))) continue;

      const contact = await db.contact.upsert({
        where: { igScopedId: event.sender.id },
        create: { igScopedId: event.sender.id, lastInboundAt: new Date(), source: "dm" },
        update: { lastInboundAt: new Date() },
      });

      // Ice breakers and menu items carry FLOW:<id> and name a flow to start.
      // Flow buttons carry a node id and resume the running session. Sending
      // one down the other's path silently does nothing.
      const flowId = parseFlowPayload(pb.payload);
      if (flowId) {
        await handleProfilePostback(db, contact.id, flowId);
      } else {
        await handlePostback(db, contact.id, pb.payload);
      }
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const v = change.value;
      if (!v?.id || !v.text) continue;
      if (await seen(v.id, "comment", v)) continue;

      await handleComment(db, {
        commentId: v.id,
        mediaId: v.media?.id ?? "",
        text: v.text,
        igScopedId: v.from?.id ?? "",
        username: v.from?.username,
      });
    }
  }
}

/**
 * Read (`messaging_seen` / `message_reads`) and delivery
 * (`message_deliveries`) receipts. Returns true when the event was one.
 *
 * Neither carries a mid of its own, so the dedup key is built from the
 * sender and the receipt's own marker; a replay of the same receipt is a
 * no-op either way, since status only moves forward.
 */
async function processReceipt(event: MessagingEvent): Promise<boolean> {
  const read = parseReadReceipt(event);
  const delivery = read ? null : parseDelivery(event);
  if (!read && !delivery) return false;

  const sender = event.sender?.id ?? "";
  if (!sender) return true;

  if (read) {
    const key = `read:${sender}:${read.mid ?? read.watermark?.getTime()}`;
    if (await seen(key, "read", event)) return true;
    await applyReadReceipt(db, read);
    return true;
  }

  if (delivery) {
    const marker = delivery.mids[0] ?? delivery.watermark?.getTime();
    if (await seen(`delivery:${sender}:${marker}`, "delivery", event)) return true;
    await applyDelivery(db, delivery);
  }
  return true;
}

/**
 * Story reply / story mention. Returns true if this event was one of them
 * and is fully handled — the caller must then skip the plain-message path.
 *
 * Both open the 24h window exactly like a DM: Meta treats them as inbound
 * user messages, and the private-reply carve-out does not apply.
 *
 * `refSkip` means a ref link already chose the flow for this event; we still
 * record the contact and the message, but do not route a second flow.
 */
async function processStoryEvent(event: MessagingEvent, refSkip: boolean): Promise<boolean> {
  const reply = parseStoryReply(event);
  const mention = reply ? null : parseStoryMention(event);
  if (!reply && !mention) return false;

  const igsid = reply?.igScopedId ?? mention?.igScopedId ?? "";
  if (!igsid) return true; // malformed, but it was a story event — don't fall through

  const kind = reply ? "story_reply" : "story_mention";
  const mid = reply?.mid ?? mention?.mid;
  if (mid && (await seen(mid, kind, event))) return true;

  const profile = await fetchProfile(igsid);
  const contact = await db.contact.upsert({
    where: { igScopedId: igsid },
    // `source` is create-only: it records where someone first arrived, and
    // overwriting it on every visit would erase that.
    create: { igScopedId: igsid, lastInboundAt: new Date(), source: kind, ...profile },
    update: { lastInboundAt: new Date(), ...profile },
  });

  await db.message.create({
    data: {
      contactId: contact.id,
      direction: "INBOUND",
      // A mention has no text of its own; label it so the inbox isn't blank.
      text: reply?.text ?? mention?.text ?? "[menção em story]",
      status: "DELIVERED",
      externalId: mid,
      payload: {
        kind,
        storyId: reply?.storyId,
        storyUrl: reply?.storyUrl ?? mention?.storyUrl,
      },
    },
  });

  if (refSkip) return true;

  if (reply) await handleStoryReply(db, contact.id, reply.text);
  else await handleStoryMention(db, contact.id);

  return true;
}

/**
 * An ig.me?ref= arrival. Returns true if a tracked link started a flow.
 *
 * Clicks are counted for any known code, conversions only when a flow
 * actually ran — the gap between the two is exactly "link works, flow is
 * off", which is the failure worth seeing in the list.
 */
async function processReferral(event: MessagingEvent): Promise<boolean> {
  const referral = parseReferral(event);
  if (!referral) return false;

  const code = normalizeRefCode(referral.ref);

  // Dedup on the mid so a Meta replay doesn't inflate the click count. A
  // standalone referral event has no mid; fall back to sender+code, which
  // is stable for the one arrival it represents.
  const dedupId =
    event.message?.mid ?? event.postback?.mid ?? `ref:${event.sender?.id ?? ""}:${code}`;
  if (await seen(dedupId, "referral", event)) return false;

  const link = await db.refLink.findUnique({ where: { code } });
  if (!link) return false;

  await db.refLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 } } });

  const igsid = event.sender?.id ?? "";
  if (!igsid) return false;

  const profile = await fetchProfile(igsid);
  const contact = await db.contact.upsert({
    where: { igScopedId: igsid },
    create: { igScopedId: igsid, lastInboundAt: new Date(), source: `ref:${code}`, ...profile },
    update: { lastInboundAt: new Date(), ...profile },
  });

  const started = await handleRefLink(db, contact.id, code);
  if (started) {
    await db.refLink.update({
      where: { id: link.id },
      data: { conversions: { increment: 1 } },
    });
  }

  return started;
}

/**
 * Piggyback the background work onto webhook traffic.
 *
 * Vercel's Hobby plan allows only ONE cron run per day, so the minute-by-
 * minute worker isn't available. Every inbound webhook is therefore also a
 * chance to resume sessions whose delay elapsed and to push a queued
 * broadcast forward. In practice a bot that receives messages drains its
 * own backlog; the daily cron is the floor for a completely idle account.
 *
 * Failures here must never affect the webhook response — it already
 * returned 200 by the time this runs.
 */
async function drainDueWork(): Promise<void> {
  try {
    await tickDelayedSessions(db);
    await sweepStaleSessions(db);

    const queued = await db.broadcast.findFirst({
      where: {
        status: { in: ["QUEUED", "SENDING"] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
    });
    if (queued) await runBroadcast(db, queued.id);

    await rollupRecent(db);
  } catch (err) {
    log.error("background drain failed", { err });
    await recordError(db, "drain", err);
  }
}

/** True if we already handled this delivery. Meta replays generously. */
async function seen(externalId: string, kind: string, raw: unknown): Promise<boolean> {
  try {
    await db.webhookEvent.create({
      data: { externalId, kind, raw: raw as object },
    });
    return false;
  } catch {
    return true; // unique violation == duplicate
  }
}

type MetaWebhook = {
  entry?: Array<{
    /**
     * One messaging event. The full shape — including reply_to.story,
     * story_mention attachments and referral — lives in lib/entry-events.ts,
     * next to the parsers that read it.
     */
    messaging?: Array<MessagingEvent & { sender: { id: string } }>;
    changes?: Array<{
      field: string;
      value?: {
        id?: string;
        text?: string;
        media?: { id?: string };
        from?: { id?: string; username?: string };
      };
    }>;
  }>;
};

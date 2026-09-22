import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../server/db";
import { verifySignature, verifyChallenge } from "../../../../lib/verify-signature";
import {
  claim,
  runClaimed,
  processMessage,
  processPostback,
  processComment,
  processStory,
  processReferral,
  processReceipt,
  receiptKey,
  type CommentValue,
} from "../../../../server/webhook-events";
import {
  parseStoryReply,
  parseStoryMention,
  parseReferral,
  normalizeRefCode,
  type MessagingEvent,
} from "../../../../lib/entry-events";
import {
  tickDelayedSessions,
  sweepStaleSessions,
  runBroadcast,
  WEBHOOK_DRAIN_BUDGET_MS,
} from "../../../../server/broadcast-worker";
import { rollupRecent } from "../../../../server/rollup";
import { recordError } from "../../../../server/error-events";
import { logger } from "../../../../lib/log";

const log = logger("webhook");

export const runtime = "nodejs"; // crypto + Prisma need Node, not Edge
export const dynamic = "force-dynamic";
/** Meta retries past ~20s; stay under it. */
export const maxDuration = 15;

/**
 * A missing secret must LOCK the endpoint, not open it.
 *
 * An empty string is a perfectly valid HMAC key: `?? ""` used to let anyone
 * sign a body with the empty key and drive the whole pipeline when the env
 * var was not set. Same for the verify token, which would otherwise hand the
 * subscription handshake to a stranger. Fail closed, like middleware.ts does.
 */
function requiredEnv(name: "IG_APP_SECRET" | "IG_VERIFY_TOKEN"): string | null {
  const value = process.env[name];
  return value && value.length > 0 ? value : null;
}

/** Meta's subscription handshake. */
export async function GET(req: NextRequest) {
  const token = requiredEnv("IG_VERIFY_TOKEN");
  if (!token) {
    return new NextResponse("IG_VERIFY_TOKEN is not set; the webhook is locked.", { status: 503 });
  }
  const challenge = verifyChallenge(req.nextUrl.searchParams, token);
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(req: NextRequest) {
  const appSecret = requiredEnv("IG_APP_SECRET");
  if (!appSecret) {
    return new NextResponse("IG_APP_SECRET is not set; the webhook is locked.", { status: 503 });
  }

  // Raw body first — parsing then re-serializing breaks the HMAC.
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  // Parse inside the guard: a signed-but-malformed body must be a 400 we
  // record, not an unhandled 500 that makes Meta retry the same batch.
  let payload: MetaWebhook;
  try {
    payload = JSON.parse(raw) as MetaWebhook;
  } catch (err) {
    await recordError(db, "webhook", err, { reason: "invalid-json" });
    return new NextResponse("Invalid JSON", { status: 400 });
  }

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

/**
 * Every event is claimed as a WebhookEvent row (dedup) and run through
 * runClaimed, which records success or failure on that row so the tick can
 * retry a failed one — see server/webhook-events.ts.
 */
async function processPayload(payload: MetaWebhook): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      // Receipts carry no message and no referral; they only move statuses.
      const receipt = receiptKey(event);
      if (receipt) {
        const kind = receipt.startsWith("read:") ? "read" : "delivery";
        const id = await claim(db, receipt, kind, event);
        if (id) await runClaimed(db, id, () => processReceipt(db, event));
        continue;
      }

      // A ref can ride along on a message, a postback, or its own event, and
      // in the first two cases the message below still needs handling. So
      // referrals are resolved first and their outcome decides whether the
      // ordinary paths should also run: a link that started a flow must not
      // then have the same message start a second one.
      const refHandled = await claimReferral(event);

      // Story replies and mentions arrive on the `messages` field too, but
      // route differently, so they are claimed before the plain-text path.
      const reply = parseStoryReply(event);
      const mention = reply ? null : parseStoryMention(event);
      if (reply || mention) {
        const kind = reply ? "story_reply" : "story_mention";
        const mid = reply?.mid ?? mention?.mid;
        const id = await claim(
          db,
          mid ?? `${kind}:${event.sender.id}:${event.timestamp}`,
          kind,
          event,
        );
        if (id) await runClaimed(db, id, () => processStory(db, event, refHandled));
        continue;
      }

      // Media-only messages have no text. Dropping them on `!text` is what
      // silently lost every photo and audio note the account ever received.
      const hasAttachments = Boolean(event.message?.attachments?.length);
      if (!event.message || event.message.is_echo) continue;
      if (!event.message.text && !hasAttachments) continue;

      const mid = event.message.mid ?? `msg:${event.sender.id}:${event.timestamp}`;
      const id = await claim(db, mid, "message", event);
      if (id) await runClaimed(db, id, () => processMessage(db, event, refHandled));
    }

    // Button and quick-reply taps arrive as postbacks, a separate event from
    // messages. Without this branch a tapped button does nothing at all.
    for (const event of entry.messaging ?? []) {
      const pb = event.postback ?? event.message?.quick_reply;
      if (!pb?.payload) continue;

      const dedupId = event.postback?.mid ?? `qr:${event.message?.mid ?? ""}`;
      const id = await claim(db, dedupId, "postback", event);
      if (id) await runClaimed(db, id, () => processPostback(db, event));
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const v = change.value;
      if (!v?.id || !v.text) continue;
      const id = await claim(db, v.id, "comment", v);
      if (id) await runClaimed(db, id, () => processComment(db, v));
    }
  }
}

/**
 * Claim and run a referral, if the event carries one. Returns true when a
 * tracked link started a flow — the signal the message path uses to stand
 * down. A replayed referral returns false so the message still records.
 */
async function claimReferral(event: MessagingEvent): Promise<boolean> {
  const referral = parseReferral(event);
  if (!referral) return false;
  const code = normalizeRefCode(referral.ref);

  // Dedup on the mid so a Meta replay doesn't inflate the click count. A
  // standalone referral event has no mid; fall back to sender+code, which
  // is stable for the one arrival it represents.
  const dedupId =
    event.message?.mid ?? event.postback?.mid ?? `ref:${event.sender?.id ?? ""}:${code}`;
  const id = await claim(db, dedupId, "referral", event);
  if (!id) return false;

  let started = false;
  await runClaimed(db, id, async () => {
    started = await processReferral(db, event);
  });
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
    // Budgeted: the drain must return the lock before Vercel kills this
    // function at maxDuration. Whatever is left resumes on the next webhook.
    if (queued) await runBroadcast(db, queued.id, { budgetMs: WEBHOOK_DRAIN_BUDGET_MS });

    await rollupRecent(db);
  } catch (err) {
    log.error("background drain failed", { err });
    await recordError(db, "drain", err);
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
      value?: CommentValue;
    }>;
  }>;
};

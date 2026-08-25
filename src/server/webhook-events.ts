import type { PrismaClient } from "@prisma/client";
import {
  handleInboundMessage,
  handleComment,
  handlePostback,
  handleStoryReply,
  handleStoryMention,
  handleRefLink,
  handleProfilePostback,
} from "./trigger-dispatch";
import { fetchProfile } from "./instagram";
import { recordInboundMessage } from "./inbound-attachments";
import { applyReadReceipt, applyDelivery } from "./receipts";
import {
  parseStoryReply,
  parseStoryMention,
  parseReferral,
  parseReadReceipt,
  parseDelivery,
  normalizeRefCode,
  type MessagingEvent,
} from "../lib/entry-events";
import { parseFlowPayload } from "../lib/messenger-profile";
import { logger } from "../lib/log";

const log = logger("webhook");

/**
 * Webhook event handlers, one per kind, plus the bookkeeping that makes a
 * failed one retryable.
 *
 * Every event is first *claimed*: a WebhookEvent row keyed by Meta's id
 * (or a synthetic one for events that carry none). The unique index is the
 * dedup — Meta replays generously — and the row is also where the outcome
 * lands: `processedAt` on success, `error` + `attempts` on failure. A
 * transient failure (database blip, Meta 5xx while replying) therefore
 * leaves a row that `reprocessFailed` picks up on the next tick and runs
 * once more, from the stored raw event.
 *
 * Handlers are written to be re-runnable: contacts are upserted, messages
 * are keyed by mid, startFlow refuses to start a second run of a flow the
 * contact is already in. A retry can still send a reply twice when the
 * first attempt failed *after* the send — that is the price of retrying at
 * all, and rarer than the failures this recovers from.
 */

export type EventKind =
  | "message"
  | "postback"
  | "comment"
  | "story_reply"
  | "story_mention"
  | "referral"
  | "read"
  | "delivery";

export type CommentValue = {
  id?: string;
  text?: string;
  media?: { id?: string };
  from?: { id?: string; username?: string };
};

/**
 * Claim an event. Returns the row id to report against, or null when this
 * delivery was already seen (a Meta replay).
 */
export async function claim(
  db: PrismaClient,
  externalId: string,
  kind: EventKind,
  raw: unknown,
): Promise<string | null> {
  try {
    const row = await db.webhookEvent.create({
      data: { externalId, kind, raw: raw as object },
      select: { id: true },
    });
    return row.id;
  } catch {
    return null; // unique violation == duplicate
  }
}

/**
 * Run `fn` for a claimed row and record how it went. Errors are swallowed
 * after being recorded: one bad event must not stop the rest of the batch,
 * and the row is what carries the failure forward.
 */
export async function runClaimed(
  db: PrismaClient,
  rowId: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  try {
    await fn();
    await db.webhookEvent.update({
      where: { id: rowId },
      data: { processedAt: new Date(), error: null, attempts: { increment: 1 } },
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("event handler failed", { rowId, err });
    await db.webhookEvent
      .update({
        where: { id: rowId },
        data: { error: message.slice(0, 2000), attempts: { increment: 1 } },
      })
      .catch(() => {}); // the failure is logged; a second one adds nothing
    return false;
  }
}

/** Retries allowed per event, counting the inline attempt. */
export const MAX_ATTEMPTS = 2;

/**
 * Re-run events whose handler failed, once each. Called from the tick.
 * Returns how many were retried and how many of those succeeded.
 */
export async function reprocessFailed(
  db: PrismaClient,
  opts: { take?: number } = {},
): Promise<{ retried: number; recovered: number }> {
  const rows = await db.webhookEvent.findMany({
    where: { processedAt: null, error: { not: null }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { receivedAt: "asc" },
    take: opts.take ?? 20,
  });

  let recovered = 0;
  for (const row of rows) {
    const ok = await runClaimed(db, row.id, () =>
      dispatch(db, row.kind as EventKind, row.raw as MessagingEvent | CommentValue),
    );
    if (ok) recovered++;
  }
  return { retried: rows.length, recovered };
}

/** Route a stored raw event to its handler, for a retry. */
async function dispatch(
  db: PrismaClient,
  kind: EventKind,
  raw: MessagingEvent | CommentValue,
): Promise<void> {
  switch (kind) {
    case "message":
      // The referral, if any, was its own row with its own outcome; the
      // retry only replays the message path.
      return processMessage(db, raw as MessagingEvent, false);
    case "postback":
      return processPostback(db, raw as MessagingEvent);
    case "comment":
      return processComment(db, raw as CommentValue);
    case "story_reply":
    case "story_mention":
      return processStory(db, raw as MessagingEvent, false);
    case "referral":
      await processReferral(db, raw as MessagingEvent);
      return;
    case "read":
    case "delivery":
      return processReceipt(db, raw as MessagingEvent);
  }
}

/** A plain DM (text and/or attachments). `refHandled`: a ref link already started the flow. */
export async function processMessage(
  db: PrismaClient,
  event: MessagingEvent,
  refHandled: boolean,
): Promise<void> {
  const msg = event.message;
  const igsid = event.sender?.id;
  if (!msg || !igsid) return;

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
    mid: msg.mid,
    text: msg.text,
    attachments: msg.attachments,
  });

  // The ref link already picked the flow for this first message; running
  // the keyword path too would start a second, competing flow.
  if (refHandled) return;

  if (msg.text) await handleInboundMessage(db, contact.id, msg.text);
}

/** A button or quick-reply tap. */
export async function processPostback(db: PrismaClient, event: MessagingEvent): Promise<void> {
  const pb = event.postback ?? event.message?.quick_reply;
  const igsid = event.sender?.id;
  if (!pb?.payload || !igsid) return;

  const contact = await db.contact.upsert({
    where: { igScopedId: igsid },
    create: { igScopedId: igsid, lastInboundAt: new Date(), source: "dm" },
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

/** A comment on one of our posts (the `comments` change field). */
export async function processComment(db: PrismaClient, v: CommentValue): Promise<void> {
  if (!v.id || !v.text) return;
  await handleComment(db, {
    commentId: v.id,
    mediaId: v.media?.id ?? "",
    text: v.text,
    igScopedId: v.from?.id ?? "",
    username: v.from?.username,
  });
}

/**
 * Story reply / story mention.
 *
 * Both open the 24h window exactly like a DM: Meta treats them as inbound
 * user messages, and the private-reply carve-out does not apply.
 *
 * `refSkip` means a ref link already chose the flow for this event; we still
 * record the contact and the message, but do not route a second flow.
 */
export async function processStory(
  db: PrismaClient,
  event: MessagingEvent,
  refSkip: boolean,
): Promise<void> {
  const reply = parseStoryReply(event);
  const mention = reply ? null : parseStoryMention(event);
  const igsid = reply?.igScopedId ?? mention?.igScopedId ?? "";
  if (!igsid) return;

  const kind = reply ? "story_reply" : "story_mention";
  const mid = reply?.mid ?? mention?.mid;

  const profile = await fetchProfile(igsid);
  const contact = await db.contact.upsert({
    where: { igScopedId: igsid },
    // `source` is create-only: it records where someone first arrived, and
    // overwriting it on every visit would erase that.
    create: { igScopedId: igsid, lastInboundAt: new Date(), source: kind, ...profile },
    update: { lastInboundAt: new Date(), ...profile },
  });

  // Keyed by mid, so a retry after a failure further down does not insert
  // the inbound message twice.
  const data = {
    contactId: contact.id,
    direction: "INBOUND" as const,
    // A mention has no text of its own; label it so the inbox isn't blank.
    text: reply?.text ?? mention?.text ?? "[menção em story]",
    status: "DELIVERED" as const,
    externalId: mid,
    payload: {
      kind,
      storyId: reply?.storyId,
      storyUrl: reply?.storyUrl ?? mention?.storyUrl,
    },
  };
  if (mid) {
    await db.message.upsert({ where: { externalId: mid }, create: data, update: {} });
  } else {
    await db.message.create({ data });
  }

  if (refSkip) return;

  if (reply) await handleStoryReply(db, contact.id, reply.text);
  else await handleStoryMention(db, contact.id);
}

/**
 * An ig.me?ref= arrival. Returns true if a tracked link started a flow.
 *
 * Clicks are counted for any known code, conversions only when a flow
 * actually ran — the gap between the two is exactly "link works, flow is
 * off", which is the failure worth seeing in the list.
 */
export async function processReferral(db: PrismaClient, event: MessagingEvent): Promise<boolean> {
  const referral = parseReferral(event);
  if (!referral) return false;
  const code = normalizeRefCode(referral.ref);

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

/** Read / delivery receipt: only moves Message.status forward. */
export async function processReceipt(db: PrismaClient, event: MessagingEvent): Promise<void> {
  const read = parseReadReceipt(event);
  if (read) {
    await applyReadReceipt(db, read);
    return;
  }
  const delivery = parseDelivery(event);
  if (delivery) await applyDelivery(db, delivery);
}

/** Dedup key for an event with no mid of its own. */
export function receiptKey(event: MessagingEvent): string | null {
  const sender = event.sender?.id ?? "";
  if (!sender) return null;
  const read = parseReadReceipt(event);
  if (read) return `read:${sender}:${read.mid ?? read.watermark?.getTime()}`;
  const delivery = parseDelivery(event);
  if (delivery) {
    return `delivery:${sender}:${delivery.mids[0] ?? delivery.watermark?.getTime()}`;
  }
  return null;
}

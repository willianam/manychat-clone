import type { PrismaClient, Trigger } from "@prisma/client";
import { startFlow, resumeWithInput, resumeWithPostback } from "./flow-runner";
import { sendPrivateReply, sendText } from "./instagram";
import { normalizeText, containsWord, normalizeForGrouping } from "../lib/text-normalize";
import {
  classifyGlobalKeyword,
  OPT_OUT_CONFIRMATION,
  OPT_IN_CONFIRMATION,
} from "../lib/global-keywords";

/**
 * Decides what an inbound event should do.
 *
 * Order matters. Global keywords come first: "parar" must work even while a
 * question is waiting, or a contact could be trapped in a flow they want out
 * of. Then a contact already parked on a question owns the message. Only
 * when nobody is waiting do we test triggers, so answering "yes" to a
 * question can't accidentally fire the "yes" keyword flow.
 */
/**
 * `isNewContact` marks the first message ever from this person. When no
 * keyword matches it, the WELCOME trigger answers before the DEFAULT one:
 * a stranger saying "oi" gets the welcome, a known contact the fallback.
 * Instagram has no Get Started button or greeting text, so this is the only
 * welcome hook the platform offers.
 */
export async function handleInboundMessage(
  db: PrismaClient,
  contactId: string,
  text: string,
  opts: { isNewContact?: boolean } = {},
): Promise<void> {
  if (await handleGlobalKeyword(db, contactId, text)) return;
  if (!(await isSubscribed(db, contactId))) return;

  const waiting = await db.flowSession.findFirst({
    where: { contactId, status: "WAITING_INPUT" },
    orderBy: { updatedAt: "desc" },
  });

  if (waiting) {
    await resumeWithInput(db, waiting, text);
    return;
  }

  const trigger = await matchKeyword(db, text);
  if (trigger) {
    await startFlow(db, trigger.flowId, contactId);
    return;
  }

  // Nothing matched. Record it before running the fallback: this is the raw
  // material for /insights — the words people actually type that we have no
  // keyword for. A DEFAULT trigger firing does not make the miss less real.
  await recordUnmatched(db, contactId, text);

  if (opts.isNewContact) {
    const welcome = await db.trigger.findFirst({
      where: { kind: "WELCOME", enabled: true, flow: { enabled: true } },
      orderBy: { priority: "desc" },
    });
    if (welcome) {
      await startFlow(db, welcome.flowId, contactId);
      return;
    }
  }

  const fallback = await db.trigger.findFirst({
    where: { kind: "DEFAULT", enabled: true, flow: { enabled: true } },
    orderBy: { priority: "desc" },
  });
  if (fallback) await startFlow(db, fallback.flowId, contactId);
}

/**
 * Global keywords, before anything else gets a say.
 *
 * Returns true when the message was fully handled here. Opt-out and opt-in
 * are; an escape word ("menu", "recomeçar") is not — it abandons the
 * contact's sessions and returns false so the message goes on to trigger
 * matching, where the owner may well have a "menu" keyword flow. Without
 * this a flow parked on a question keeps the contact forever: every word
 * they type is taken as the answer.
 *
 * Opting out abandons the sessions for the same reason. The confirmation is
 * best-effort: the contact just wrote, so the window is open, but a send
 * failure must not undo the opt-out itself.
 */
async function handleGlobalKeyword(
  db: PrismaClient,
  contactId: string,
  text: string,
): Promise<boolean> {
  const command = classifyGlobalKeyword(text);
  if (!command) return false;

  if (command === "escape") {
    await abandonSessions(db, contactId);
    return false;
  }

  const subscribed = command === "opt_in";
  await db.contact.update({ where: { id: contactId }, data: { subscribed } });

  if (!subscribed) await abandonSessions(db, contactId);

  await sendText(db, contactId, subscribed ? OPT_IN_CONFIRMATION : OPT_OUT_CONFIRMATION).catch(
    (err) => console.warn("[dispatch] opt-out confirmation failed:", err),
  );
  return true;
}

async function abandonSessions(db: PrismaClient, contactId: string): Promise<void> {
  await db.flowSession.updateMany({
    where: { contactId, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
    data: { status: "ABANDONED" },
  });
}

/**
 * An opted-out contact gets nothing automated: no session resume, no
 * trigger, and no entry in the unmatched list — their messages are not
 * keyword gaps, they are a person who asked to be left alone.
 */
async function isSubscribed(db: PrismaClient, contactId: string): Promise<boolean> {
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { subscribed: true },
  });
  return contact?.subscribed ?? false;
}

/**
 * Aggregate a miss by its normalized form.
 *
 * Forty people typing "preço", "Preco" and "PREÇO?" are one row with a count
 * of 40, not forty rows — the whole point of the panel is to surface the
 * frequent gaps, and unaggregated rows bury them. `lastContactId` keeps a
 * way back to a real conversation without storing a growing list.
 *
 * Never throws: a failure to record analytics must not stop us replying.
 */
async function recordUnmatched(db: PrismaClient, contactId: string, text: string): Promise<void> {
  const normalized = normalizeForGrouping(text);
  if (!normalized) return; // a sticker or a bare emoji has no keyword to suggest

  try {
    await db.unmatchedMessage.upsert({
      where: { normalized },
      create: {
        normalized,
        sample: text.slice(0, 500),
        lastContactId: contactId,
        count: 1,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        lastContactId: contactId,
      },
    });
  } catch {
    // Analytics is best-effort; the reply matters more.
  }
}

/**
 * Route a button or quick-reply tap to the session waiting on it.
 *
 * A tap on a stale button (the contact scrolled up and pressed an old one)
 * is ignored rather than rewinding the conversation — resumeWithPostback
 * checks that the payload names the node the session actually sits on.
 */
export async function handlePostback(
  db: PrismaClient,
  contactId: string,
  payload: string,
): Promise<void> {
  const waiting = await db.flowSession.findFirst({
    where: { contactId, status: "WAITING_INPUT" },
    orderBy: { updatedAt: "desc" },
  });
  if (!waiting) return;
  await resumeWithPostback(db, waiting, payload);
}

/**
 * Comment-to-DM. The private reply is what opens the messaging window, so
 * it must land before the flow tries to send anything.
 */
export async function handleComment(
  db: PrismaClient,
  args: { commentId: string; mediaId: string; text: string; igScopedId: string; username?: string },
): Promise<void> {
  const trigger = await matchComment(db, args.text, args.mediaId);
  if (!trigger) return;

  const flow = await db.flow.findUnique({ where: { id: trigger.flowId } });
  if (!flow?.enabled) return;

  // Send first: the reply is what opens the messaging window, and its
  // response carries the messaging-scoped id. The id on a comment webhook
  // is not always the same scope, so prefer the one the API hands back.
  const { recipientId } = await sendPrivateReply(args.commentId, openingLine(flow.name));
  const igScopedId = recipientId || args.igScopedId;
  if (!igScopedId) return;

  // A private reply counts as contact-initiated: the 24h clock starts now.
  const contact = await db.contact.upsert({
    where: { igScopedId },
    create: { igScopedId, username: args.username, lastInboundAt: new Date() },
    update: { username: args.username, lastInboundAt: new Date() },
  });

  await startFlow(db, trigger.flowId, contact.id);
}

/**
 * A story reply. The user answered one of our stories, which is an inbound
 * DM in every sense: the 24h window opens and a keyword can match.
 *
 * STORY_REPLY triggers are tested first — a story-specific trigger should
 * beat a generic keyword answering the same word. Falling through to the
 * ordinary inbound path is deliberate: a reply carrying a keyword should
 * still fire that keyword's flow rather than dead-end.
 */
export async function handleStoryReply(
  db: PrismaClient,
  contactId: string,
  text: string,
): Promise<void> {
  // Global keywords and opt-out apply here exactly as to a plain DM.
  if (await handleGlobalKeyword(db, contactId, text)) return;
  if (!(await isSubscribed(db, contactId))) return;

  // A session parked on a question owns the reply, same as any message.
  const waiting = await db.flowSession.findFirst({
    where: { contactId, status: "WAITING_INPUT" },
    orderBy: { updatedAt: "desc" },
  });
  if (waiting) {
    await resumeWithInput(db, waiting, text);
    return;
  }

  const trigger = await matchByKind(db, "STORY_REPLY", text);
  if (trigger) {
    await startFlow(db, trigger.flowId, contactId);
    return;
  }

  await handleInboundMessage(db, contactId, text);
}

/**
 * A story mention. The user put us in their story — there is no text to
 * match, so the only routing possible is "the" story-mention trigger.
 *
 * Patternless by nature: whichever enabled STORY_MENTION trigger has the
 * highest priority wins.
 */
export async function handleStoryMention(db: PrismaClient, contactId: string): Promise<void> {
  const trigger = await db.trigger.findFirst({
    where: { kind: "STORY_MENTION", enabled: true, flow: { enabled: true } },
    orderBy: { priority: "desc" },
  });
  if (!trigger) return;
  await startFlow(db, trigger.flowId, contactId);
}

/**
 * An ig.me?ref= arrival. The code names the flow directly, so no matching is
 * involved — but the link must still be enabled and point at a live flow.
 *
 * Returns whether a flow actually started, which is what the caller records
 * as a conversion (a click on a link whose flow is switched off is a click,
 * not a conversion).
 */
export async function handleRefLink(
  db: PrismaClient,
  contactId: string,
  code: string,
): Promise<boolean> {
  const link = await db.refLink.findUnique({ where: { code } });
  if (!link || !link.enabled) return false;

  const result = await startFlow(db, link.flowId, contactId);
  return result !== null;
}

/**
 * A tap on an ice breaker or a persistent-menu item.
 *
 * These payloads name a FLOW, not a node, so they must never reach
 * resumeWithPostback — which would compare the flow id against the node the
 * session sits on and discard it as a stale button.
 */
export async function handleProfilePostback(
  db: PrismaClient,
  contactId: string,
  flowId: string,
): Promise<void> {
  // Starting a flow while another is mid-question would leave the old
  // session orphaned and waiting forever. An explicit menu tap is a clear
  // intent to switch, so abandon what was running.
  await db.flowSession.updateMany({
    where: { contactId, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
    data: { status: "ABANDONED" },
  });

  await startFlow(db, flowId, contactId);
}

/** Highest-priority enabled trigger of `kind` whose pattern matches `text`. */
async function matchByKind(
  db: PrismaClient,
  kind: "STORY_REPLY",
  text: string,
): Promise<Trigger | null> {
  const candidates = await db.trigger.findMany({
    where: { kind, enabled: true, flow: { enabled: true } },
    orderBy: { priority: "desc" },
  });
  // A patternless trigger of this kind is a catch-all for the whole kind.
  return candidates.find((t) => (t.pattern ? matches(t, text) : true)) ?? null;
}

async function matchKeyword(db: PrismaClient, text: string): Promise<Trigger | null> {
  const candidates = await db.trigger.findMany({
    where: { kind: "KEYWORD", enabled: true, flow: { enabled: true } },
    orderBy: { priority: "desc" },
  });
  return candidates.find((t) => matches(t, text)) ?? null;
}

async function matchComment(
  db: PrismaClient,
  text: string,
  mediaId: string,
): Promise<Trigger | null> {
  const candidates = await db.trigger.findMany({
    where: {
      kind: "COMMENT",
      enabled: true,
      flow: { enabled: true },
      OR: [{ mediaId: null }, { mediaId }],
    },
    orderBy: [{ mediaId: "desc" }, { priority: "desc" }], // post-specific wins over catch-all
  });
  return candidates.find((t) => matches(t, text)) ?? null;
}

/**
 * Does this trigger fire for this text?
 *
 * EXACT and CONTAINS compare normalized forms on BOTH sides, so an accent,
 * a trailing "!!!" or a waving emoji never decides whether a keyword fires.
 * See lib/text-normalize.ts for what normalization folds away.
 *
 * REGEX is left alone on purpose: the owner wrote that pattern against the
 * literal message, and silently folding accents out from under it would
 * break patterns that match accents deliberately.
 */
export function matches(trigger: Pick<Trigger, "pattern" | "match">, text: string): boolean {
  if (!trigger.pattern) return false;

  if (trigger.match === "REGEX") {
    try {
      return new RegExp(trigger.pattern, "i").test(text);
    } catch {
      return false; // a bad pattern must not take the webhook down
    }
  }

  const haystack = normalizeText(text);
  const needle = normalizeText(trigger.pattern);
  if (!needle) return false;

  switch (trigger.match) {
    case "EXACT":
      return haystack === needle;
    case "CONTAINS":
      // Word-boundary match so "oi" doesn't fire inside "coisa".
      return containsWord(haystack, needle);
    default:
      return false;
  }
}

function openingLine(flowName: string): string {
  return `Oi! Vi seu comentário e já te mandei os detalhes aqui. (${flowName})`;
}

import type { PrismaClient, Trigger } from "@prisma/client";
import { startFlow, resumeWithInput, resumeWithPostback } from "./flow-runner";
import { sendPrivateReply } from "./instagram";

/**
 * Decides what an inbound event should do.
 *
 * Order matters: a contact already parked on a question owns the message.
 * Only when nobody is waiting do we test triggers, so answering "yes" to a
 * question can't accidentally fire the "yes" keyword flow.
 */
export async function handleInboundMessage(
  db: PrismaClient,
  contactId: string,
  text: string,
): Promise<void> {
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

  const fallback = await db.trigger.findFirst({
    where: { kind: "DEFAULT", enabled: true, flow: { enabled: true } },
    orderBy: { priority: "desc" },
  });
  if (fallback) await startFlow(db, fallback.flowId, contactId);
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

function matches(trigger: Trigger, text: string): boolean {
  if (!trigger.pattern) return false;
  const haystack = text.toLowerCase().trim();
  const needle = trigger.pattern.toLowerCase().trim();

  switch (trigger.match) {
    case "EXACT":
      return haystack === needle;
    case "CONTAINS":
      // Word-boundary match so "oi" doesn't fire inside "coisa".
      return new RegExp(`\\b${escapeRegex(needle)}\\b`, "i").test(haystack);
    case "REGEX":
      try {
        return new RegExp(trigger.pattern, "i").test(text);
      } catch {
        return false; // a bad pattern must not take the webhook down
      }
    default:
      return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openingLine(flowName: string): string {
  return `Oi! Vi seu comentário e já te mandei os detalhes aqui. (${flowName})`;
}

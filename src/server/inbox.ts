import type { PrismaClient } from "@prisma/client";

/**
 * Inbox: the operator's view of conversations.
 *
 * Nothing here is new data — messages, contacts and flow sessions already
 * exist. What the inbox adds is *ordering* (Contact.lastMessageAt), the
 * *read mark* (Contact.lastReadAt) and the *human takeover* switch
 * (Contact.automationPaused).
 */

/**
 * Bump `Contact.lastMessageAt`. The one place the inbox order is written
 * from; every Message write (inbound webhook, outbound send) calls it.
 *
 * Best-effort on purpose: a missing timestamp misorders one row in the
 * inbox, while a thrown error here would fail the send or the webhook.
 */
export async function touchLastMessage(
  db: PrismaClient,
  contactId: string,
  at: Date = new Date(),
): Promise<void> {
  try {
    await db.contact.update({ where: { id: contactId }, data: { lastMessageAt: at } });
  } catch (err) {
    console.warn(`[inbox] failed to touch lastMessageAt for ${contactId}:`, err);
  }
}

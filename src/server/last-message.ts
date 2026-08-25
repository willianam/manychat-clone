import type { PrismaClient } from "@prisma/client";

/**
 * Bump `Contact.lastMessageAt`, the inbox order. The one function every
 * Message write (inbound webhook, outbound send) calls.
 *
 * Its own module, with no imports of its own, because inbound-attachments.ts
 * calls it and the inbox UI imports that file's pure helpers: anything this
 * pulls in would land in the browser bundle.
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

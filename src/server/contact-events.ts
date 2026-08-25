import type { ContactEventKind, Prisma, PrismaClient } from "@prisma/client";

/**
 * Timeline events. One row per mutation, written where the mutation happens.
 *
 * Never throws: an event is a record of something that already succeeded,
 * and failing the tag write (or the send that follows it) because the
 * history row did not land would be backwards.
 */
export async function recordContactEvent(
  db: PrismaClient,
  contactId: string,
  kind: ContactEventKind,
  payload?: Prisma.InputJsonObject,
): Promise<void> {
  try {
    await db.contactEvent.create({ data: { contactId, kind, payload } });
  } catch (err) {
    console.warn(`[contact-events] failed to record ${kind} for ${contactId}:`, err);
  }
}

/** Tag add/remove shared by the action node, the legacy tag node and the CSV import. */
export async function addTagToContact(
  db: PrismaClient,
  contactId: string,
  tagName: string,
  via: string,
): Promise<void> {
  const tag = await db.tag.upsert({
    where: { name: tagName },
    create: { name: tagName },
    update: {},
  });
  const link = await db.contactTag.findUnique({
    where: { contactId_tagId: { contactId, tagId: tag.id } },
  });
  if (link) return; // already there: no change, no event
  await db.contactTag.create({ data: { contactId, tagId: tag.id } });
  await recordContactEvent(db, contactId, "TAG_ADDED", { tagId: tag.id, tagName, via });
}

export async function removeTagFromContact(
  db: PrismaClient,
  contactId: string,
  tagName: string,
  via: string,
): Promise<void> {
  const tag = await db.tag.findUnique({ where: { name: tagName } });
  if (!tag) return;
  const { count } = await db.contactTag.deleteMany({ where: { contactId, tagId: tag.id } });
  if (count === 0) return;
  await recordContactEvent(db, contactId, "TAG_REMOVED", { tagId: tag.id, tagName, via });
}

/**
 * Flip the opt-out flag and record it. Unsubscribing also abandons every
 * open session — the same rule the "parar" keyword applies, because a
 * contact who opted out must not keep getting asked the current question.
 */
export async function setContactSubscribed(
  db: PrismaClient,
  contactId: string,
  subscribed: boolean,
  via: string,
): Promise<void> {
  const before = await db.contact.findUnique({
    where: { id: contactId },
    select: { subscribed: true },
  });
  await db.contact.update({ where: { id: contactId }, data: { subscribed } });
  if (!subscribed) {
    await db.flowSession.updateMany({
      where: { contactId, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
      data: { status: "ABANDONED" },
    });
  }
  if (before && before.subscribed === subscribed) return;
  await recordContactEvent(db, contactId, subscribed ? "SUBSCRIBED" : "UNSUBSCRIBED", { via });
}

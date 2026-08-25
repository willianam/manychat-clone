import type { PrismaClient } from "@prisma/client";
import type { DeliveryEvent, ReadReceiptEvent } from "../lib/entry-events";

/**
 * Applies read and delivery receipts to Message.status.
 *
 * Status only ever moves forward (SENT → DELIVERED → READ): a delivery
 * receipt that arrives after the read receipt must not demote a READ row,
 * and a FAILED row is never touched — Meta cannot deliver what it rejected.
 *
 * Watermarks are inclusive ("at or before this timestamp"), matched against
 * our own `createdAt`. Our clock and Meta's differ by at most seconds, and
 * a message created a moment after the watermark will be covered by the
 * next receipt, so the imprecision is harmless.
 *
 * Broadcast recipients move with the messages: a recipient row records
 * `sentAt` for the one message the broadcast sent that contact, so the
 * same watermark that marks the message read marks the recipient read.
 * Without this the report could never say "lido", only "enviado".
 */

export async function applyReadReceipt(db: PrismaClient, r: ReadReceiptEvent): Promise<number> {
  const contact = await db.contact.findUnique({
    where: { igScopedId: r.igScopedId },
    select: { id: true },
  });
  if (!contact) return 0;

  // Instagram names the last message read; everything we sent up to that
  // message was read too, so its createdAt becomes the watermark.
  let watermark = r.watermark;
  if (r.mid) {
    const last = await db.message.findUnique({
      where: { externalId: r.mid },
      select: { createdAt: true },
    });
    if (last && (!watermark || last.createdAt > watermark)) watermark = last.createdAt;
  }
  if (!watermark) return 0;

  const { count } = await db.message.updateMany({
    where: {
      contactId: contact.id,
      direction: "OUTBOUND",
      status: { in: ["SENT", "DELIVERED"] },
      createdAt: { lte: watermark },
    },
    data: { status: "READ" },
  });
  await db.broadcastRecipient.updateMany({
    where: {
      contactId: contact.id,
      status: { in: ["SENT", "DELIVERED"] },
      sentAt: { lte: watermark },
    },
    data: { status: "READ" },
  });
  return count;
}

export async function applyDelivery(db: PrismaClient, d: DeliveryEvent): Promise<number> {
  const contact = await db.contact.findUnique({
    where: { igScopedId: d.igScopedId },
    select: { id: true },
  });
  if (!contact) return 0;

  let count = 0;
  let watermark = d.watermark;

  if (d.mids.length) {
    const r = await db.message.updateMany({
      where: { contactId: contact.id, externalId: { in: d.mids }, status: "SENT" },
      data: { status: "DELIVERED" },
    });
    count += r.count;
    // The newest delivered mid covers every broadcast send before it.
    const last = await db.message.findFirst({
      where: { externalId: { in: d.mids } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last && (!watermark || last.createdAt > watermark)) watermark = last.createdAt;
  }

  if (d.watermark) {
    const r = await db.message.updateMany({
      where: {
        contactId: contact.id,
        direction: "OUTBOUND",
        status: "SENT",
        createdAt: { lte: d.watermark },
        ...(d.mids.length ? { externalId: { notIn: d.mids } } : {}),
      },
      data: { status: "DELIVERED" },
    });
    count += r.count;
  }

  if (watermark) {
    await db.broadcastRecipient.updateMany({
      where: { contactId: contact.id, status: "SENT", sentAt: { lte: watermark } },
      data: { status: "DELIVERED" },
    });
  }

  return count;
}

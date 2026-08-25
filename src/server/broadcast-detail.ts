import type { PrismaClient } from "@prisma/client";
import { isWindowError } from "./broadcast-worker";

/**
 * The report page's read model and the two mutations the compose screen
 * does not have: duplicate and cancel. `broadcastReport` / `retryFailed` in
 * broadcast-worker.ts stay the source of truth for what is retryable; this
 * file only adds the per-status breakdown and the recipient table.
 */

export type RecipientBucket = "pending" | "sent" | "delivered" | "read" | "failed" | "skipped";

export const BUCKET_LABEL: Record<RecipientBucket, string> = {
  pending: "na fila",
  sent: "enviado",
  delivered: "entregue",
  read: "lido",
  failed: "falhou",
  skipped: "pulado (fora da janela)",
};

export type RecipientRow = {
  id: string;
  contactId: string;
  username: string | null;
  name: string | null;
  bucket: RecipientBucket;
  error: string | null;
  sentAt: Date | null;
};

export type BroadcastDetail = {
  counts: Record<RecipientBucket, number> & { total: number };
  recipients: RecipientRow[];
};

/**
 * "Skipped" is a FAILED row whose error came from the window check: the
 * send never happened and retrying cannot help. Everything else under
 * FAILED is a real failure `retryFailed` will pick up.
 */
export function bucketOf(status: string, error: string | null): RecipientBucket {
  switch (status) {
    case "PENDING":
      return "pending";
    case "SENT":
      return "sent";
    case "DELIVERED":
      return "delivered";
    case "READ":
      return "read";
    default:
      return isWindowError(error) ? "skipped" : "failed";
  }
}

export async function broadcastDetail(
  db: PrismaClient,
  broadcastId: string,
  opts: { bucket?: RecipientBucket | null; take?: number } = {},
): Promise<BroadcastDetail> {
  const rows = await db.broadcastRecipient.findMany({
    where: { broadcastId },
    select: {
      id: true,
      contactId: true,
      status: true,
      error: true,
      sentAt: true,
      contact: { select: { username: true, name: true } },
    },
    orderBy: { sentAt: "desc" },
  });

  const counts = {
    pending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    skipped: 0,
    total: rows.length,
  };
  const all: RecipientRow[] = rows.map((r) => {
    const bucket = bucketOf(r.status, r.error);
    counts[bucket]++;
    return {
      id: r.id,
      contactId: r.contactId,
      username: r.contact.username,
      name: r.contact.name,
      bucket,
      error: r.error,
      sentAt: r.sentAt,
    };
  });

  const filtered = opts.bucket ? all.filter((r) => r.bucket === opts.bucket) : all;
  return { counts, recipients: filtered.slice(0, opts.take ?? 500) };
}

/** A DRAFT copy with the same body, audience and tag; never the schedule or the recipients. */
export async function duplicateBroadcast(db: PrismaClient, broadcastId: string) {
  const b = await db.broadcast.findUniqueOrThrow({ where: { id: broadcastId } });
  return db.broadcast.create({
    data: {
      name: `${b.name} (cópia)`.slice(0, 120),
      text: b.text,
      content: b.content ?? undefined,
      flowId: b.flowId,
      tag: b.tag,
      filterTagIds: b.filterTagIds,
      segmentId: b.segmentId,
      status: "DRAFT",
    },
  });
}

/**
 * Take a queued broadcast back to DRAFT before a drainer picks it up.
 *
 * Only QUEUED rows are cancellable: a SENDING one is being walked right
 * now, and pulling its recipients from under the drainer would leave the
 * report lying about what went out. Materialized recipients are removed so
 * a later "enfileirar" recounts the audience at that moment.
 */
export async function cancelBroadcast(db: PrismaClient, broadcastId: string): Promise<boolean> {
  const { count } = await db.broadcast.updateMany({
    where: { id: broadcastId, status: "QUEUED" },
    data: { status: "DRAFT", lockedAt: null },
  });
  if (count === 0) return false;
  await db.broadcastRecipient.deleteMany({ where: { broadcastId } });
  return true;
}

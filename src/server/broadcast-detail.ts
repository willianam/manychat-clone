import type { Prisma, PrismaClient } from "@prisma/client";
import {
  BUCKET_LABEL,
  bucketOf,
  WINDOW_ERROR_PHRASES,
  type RecipientBucket,
} from "./recipient-bucket";

/**
 * The report page's read model and the two mutations the compose screen
 * does not have: duplicate and cancel. `broadcastReport` / `retryFailed` in
 * broadcast-worker.ts stay the source of truth for what is retryable; this
 * file only adds the per-status breakdown and the recipient table.
 *
 * The recipient classifier itself lives in recipient-bucket.ts now — it is
 * shared with broadcastReport — and is re-exported here so the report page
 * keeps importing it from where it always did.
 */
export { BUCKET_LABEL, bucketOf };
export type { RecipientBucket };

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
 * Prisma `where` fragments per bucket, so the database does the filtering.
 *
 * "Skipped" is FAILED whose error text came from the window check; "failed"
 * is FAILED that is anything else. Expressed against WINDOW_ERROR_PHRASES,
 * the same list `isWindowError` reads, so the in-memory classifier and this
 * query cannot drift apart.
 */
const windowErrorWhere: Prisma.BroadcastRecipientWhereInput = {
  OR: WINDOW_ERROR_PHRASES.map((phrase) => ({
    error: { contains: phrase, mode: "insensitive" as const },
  })),
};

const BUCKET_WHERE: Record<RecipientBucket, Prisma.BroadcastRecipientWhereInput> = {
  pending: { status: "PENDING" },
  sent: { status: "SENT" },
  delivered: { status: "DELIVERED" },
  read: { status: "READ" },
  skipped: { status: "FAILED", ...windowErrorWhere },
  failed: { status: "FAILED", NOT: windowErrorWhere },
};

/**
 * Counts from an aggregate, rows from a paged query.
 *
 * This used to read EVERY recipient of the broadcast with its contact joined
 * in, classify all of them in JS, and only then filter and `.slice(0, 500)` —
 * so a 3.000-person broadcast moved 3.000 joined rows to render at most 500.
 * `broadcastReport`, right next door, already did counts with `groupBy`; this
 * follows that pattern.
 */
export async function broadcastDetail(
  db: PrismaClient,
  broadcastId: string,
  opts: { bucket?: RecipientBucket | null; take?: number } = {},
): Promise<BroadcastDetail> {
  const take = opts.take ?? 500;

  const [grouped, skipped, rows] = await Promise.all([
    db.broadcastRecipient.groupBy({
      by: ["status"],
      where: { broadcastId },
      _count: { _all: true },
    }),
    // The only count groupBy cannot give: FAILED needs the error text read.
    db.broadcastRecipient.count({ where: { broadcastId, ...BUCKET_WHERE.skipped } }),
    db.broadcastRecipient.findMany({
      where: { broadcastId, ...(opts.bucket ? BUCKET_WHERE[opts.bucket] : {}) },
      select: {
        id: true,
        contactId: true,
        status: true,
        error: true,
        sentAt: true,
        contact: { select: { username: true, name: true } },
      },
      orderBy: { sentAt: "desc" },
      take,
    }),
  ]);

  const counts = {
    pending: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    skipped,
    total: 0,
  };
  for (const g of grouped) {
    const n = g._count._all;
    counts.total += n;
    if (g.status === "FAILED") counts.failed += n - skipped;
    else counts[bucketOf(g.status, null) as "pending" | "sent" | "delivered" | "read"] += n;
  }

  const recipients: RecipientRow[] = rows.map((r) => ({
    id: r.id,
    contactId: r.contactId,
    username: r.contact.username,
    name: r.contact.name,
    bucket: bucketOf(r.status, r.error),
    error: r.error,
    sentAt: r.sentAt,
  }));

  return { counts, recipients };
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

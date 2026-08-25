import type { Prisma, PrismaClient } from "@prisma/client";
import { WINDOW_MS } from "../lib/messaging-window";
import { CONTACTS_PAGE_SIZE, type ContactQuery } from "../lib/contact-query";
import type { SegmentRules } from "../lib/segment-rules";
import {
  SEGMENT_CONTACT_SELECT,
  filterSegment,
  needsFilter,
  parseSegmentRules,
  segmentWhere,
} from "./segments";

/**
 * The contact list, paginated in the database.
 *
 * Everything the query string carries becomes a where clause here, with one
 * exception: a saved segment whose rules Postgres cannot evaluate (see
 * lib/segment-rules.ts) is resolved to an id list first, then paginated like
 * any other filter. That keeps `take`/`skip` honest instead of paginating a
 * superset and showing short pages.
 */

export const CONTACT_ROW_SELECT = {
  id: true,
  name: true,
  username: true,
  profilePic: true,
  lastInboundAt: true,
  subscribed: true,
  source: true,
  createdAt: true,
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.ContactSelect;

export type ContactRow = Prisma.ContactGetPayload<{ select: typeof CONTACT_ROW_SELECT }>;

export type ContactPage = {
  rows: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/** The filters other than the segment, as a where. `now` decides the window. */
export function contactFilterWhere(q: ContactQuery, now = new Date()): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];

  if (q.q) {
    and.push({
      OR: [
        { name: { contains: q.q, mode: "insensitive" } },
        { username: { contains: q.q.replace(/^@/, ""), mode: "insensitive" } },
      ],
    });
  }
  for (const tagId of q.tags) and.push({ tags: { some: { tagId } } });
  if (q.subscribed !== undefined) and.push({ subscribed: q.subscribed });
  if (q.source) and.push({ source: q.source });

  // Same cutoff as canSend: inside the window means elapsed <= 24h.
  const cutoff = new Date(now.getTime() - WINDOW_MS);
  if (q.window === "in") and.push({ lastInboundAt: { gte: cutoff } });
  if (q.window === "out")
    and.push({ OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: cutoff } }] });

  return and.length ? { AND: and } : {};
}

export function contactOrderBy(q: ContactQuery): Prisma.ContactOrderByWithRelationInput[] {
  switch (q.sort) {
    case "name":
      return [{ name: { sort: q.dir, nulls: "last" } }, { username: q.dir }];
    case "createdAt":
      return [{ createdAt: q.dir }];
    default:
      return [{ lastInboundAt: { sort: q.dir, nulls: "last" } }, { createdAt: "desc" }];
  }
}

/**
 * The full where for a query, segment included. A segment that needs the
 * in-memory evaluator is resolved to `id IN (...)` here, so callers (the
 * list, the CSV export) can treat the result as one plain where.
 */
export async function contactsWhere(
  db: PrismaClient,
  q: ContactQuery,
  now = new Date(),
): Promise<Prisma.ContactWhereInput> {
  const base = contactFilterWhere(q, now);
  if (!q.segment) return base;

  const segment = await db.segment.findUnique({ where: { id: q.segment } });
  if (!segment) return base;
  const rules: SegmentRules = parseSegmentRules(segment.rules);
  const where = { AND: [base, segmentWhere(rules)] };
  if (!needsFilter(rules)) return where;

  const rows = await db.contact.findMany({ where, select: SEGMENT_CONTACT_SELECT });
  const ids = filterSegment(rows, rules, now).map((r) => r.id);
  return { id: { in: ids } };
}

export async function listContacts(
  db: PrismaClient,
  q: ContactQuery,
  now = new Date(),
): Promise<ContactPage> {
  const where = await contactsWhere(db, q, now);
  const pageSize = CONTACTS_PAGE_SIZE;
  const total = await db.contact.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(q.page, pageCount);

  const rows = await db.contact.findMany({
    where,
    orderBy: contactOrderBy(q),
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: CONTACT_ROW_SELECT,
  });

  return { rows, total, page, pageSize, pageCount };
}

/** Distinct `source` values, for the filter dropdown. */
export async function listContactSources(db: PrismaClient): Promise<string[]> {
  const rows = await db.contact.findMany({
    where: { source: { not: null } },
    distinct: ["source"],
    select: { source: true },
    orderBy: { source: "asc" },
  });
  return rows.map((r) => r.source).filter((s): s is string => Boolean(s));
}

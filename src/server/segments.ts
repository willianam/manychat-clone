import type { Prisma, PrismaClient, Segment } from "@prisma/client";
import {
  SegmentRules,
  isMemoryRule,
  matchesSegment,
  type SegmentContact,
  type SegmentRule,
} from "../lib/segment-rules";

/**
 * Saved segments.
 *
 * The split between database and memory is explained in lib/segment-rules.ts.
 * The contract here: `segmentWhere` never over-restricts (a contact the rules
 * match is always in its result set) and `filterSegment` finishes the job.
 * `resolveSegment` composes the two and is what broadcasts use.
 */

/** Prisma select that yields exactly what the in-memory evaluator needs. */
export const SEGMENT_CONTACT_SELECT = {
  id: true,
  lastInboundAt: true,
  subscribed: true,
  source: true,
  createdAt: true,
  tags: { select: { tagId: true } },
  fields: { select: { key: true, value: true } },
} satisfies Prisma.ContactSelect;

function ruleWhere(rule: SegmentRule): Prisma.ContactWhereInput | null {
  switch (rule.kind) {
    case "tag":
      return rule.op === "has"
        ? { tags: { some: { tagId: rule.value } } }
        : { tags: { none: { tagId: rule.value } } };
    case "field":
      switch (rule.op) {
        case "exists":
          return { fields: { some: { key: rule.key, value: { not: "" } } } };
        case "missing":
          return {
            OR: [
              { fields: { none: { key: rule.key } } },
              { fields: { some: { key: rule.key, value: "" } } },
            ],
          };
        case "equals":
          return {
            fields: {
              some: { key: rule.key, value: { equals: rule.value ?? "", mode: "insensitive" } },
            },
          };
        case "contains":
          return {
            fields: {
              some: { key: rule.key, value: { contains: rule.value ?? "", mode: "insensitive" } },
            },
          };
        default:
          return null; // ordered comparison: memory only
      }
    case "lastInbound":
      if (rule.op === "never") return { lastInboundAt: null };
      return {
        lastInboundAt:
          rule.op === "after" ? { gt: new Date(rule.value!) } : { lt: new Date(rule.value!) },
      };
    case "source":
      return rule.op === "equals" ? { source: rule.value } : { source: { startsWith: rule.value } };
    case "subscribed":
      return { subscribed: rule.value };
    case "window":
      return null;
    case "createdAt":
      return {
        createdAt:
          rule.op === "after" ? { gt: new Date(rule.value) } : { lt: new Date(rule.value) },
      };
  }
}

/**
 * The database half of a segment.
 *
 * `and`: every pushable rule is ANDed; memory rules are simply left out,
 * which only widens the set. `or`: the OR of pushable rules — but if any
 * rule is memory-only, the OR cannot be expressed without it, so the where is
 * empty and `filterSegment` decides everything.
 */
export function segmentWhere(rules: SegmentRules): Prisma.ContactWhereInput {
  const pushable = rules.rules
    .map(ruleWhere)
    .filter((w): w is Prisma.ContactWhereInput => w !== null);
  if (pushable.length === 0) return {};

  if (rules.combinator === "and") return { AND: pushable };

  if (rules.rules.some(isMemoryRule)) return {};
  return { OR: pushable };
}

/** True when `segmentWhere` alone is not the full answer. */
export function needsFilter(rules: SegmentRules): boolean {
  return rules.rules.some(isMemoryRule);
}

/** The memory half: drop rows the where clause could not exclude. */
export function filterSegment<T extends SegmentContact>(
  rows: T[],
  rules: SegmentRules,
  now = new Date(),
): T[] {
  if (!needsFilter(rules)) return rows;
  return rows.filter((c) => matchesSegment(c, rules, now));
}

/**
 * Contacts the segment matches, optionally narrowed by an extra where (a
 * broadcast adds `subscribed: true`, for instance).
 */
export async function resolveSegment(
  db: PrismaClient,
  rules: SegmentRules,
  extra: Prisma.ContactWhereInput = {},
  now = new Date(),
) {
  const rows = await db.contact.findMany({
    where: { AND: [segmentWhere(rules), extra] },
    select: SEGMENT_CONTACT_SELECT,
  });
  return filterSegment(rows, rules, now);
}

export async function countSegment(db: PrismaClient, rules: SegmentRules, now = new Date()) {
  if (!needsFilter(rules)) return db.contact.count({ where: segmentWhere(rules) });
  return (await resolveSegment(db, rules, {}, now)).length;
}

/** A sample of matching contacts, for the segment builder. */
export async function previewSegment(
  db: PrismaClient,
  rules: SegmentRules,
  opts: { take?: number; now?: Date } = {},
) {
  const take = opts.take ?? 20;
  const rows = await db.contact.findMany({
    where: segmentWhere(rules),
    select: { ...SEGMENT_CONTACT_SELECT, username: true, name: true },
    orderBy: { lastInboundAt: "desc" },
    // Over-fetch when a memory rule may drop rows; bounded so a segment that
    // matches nobody cannot pull the whole table.
    take: needsFilter(rules) ? take * 10 : take,
  });
  return filterSegment(rows, rules, opts.now).slice(0, take);
}

export function parseSegmentRules(input: unknown): SegmentRules {
  return SegmentRules.parse(input);
}

export function listSegments(db: PrismaClient): Promise<Segment[]> {
  return db.segment.findMany({ orderBy: { name: "asc" } });
}

export function createSegment(db: PrismaClient, name: string, rules: unknown): Promise<Segment> {
  const clean = name.trim();
  if (!clean) throw new Error("O segmento precisa de um nome.");
  return db.segment.create({ data: { name: clean, rules: parseSegmentRules(rules) } });
}

export function updateSegment(
  db: PrismaClient,
  id: string,
  data: { name?: string; rules?: unknown },
): Promise<Segment> {
  return db.segment.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.rules !== undefined ? { rules: parseSegmentRules(data.rules) } : {}),
    },
  });
}

export async function deleteSegment(db: PrismaClient, id: string): Promise<void> {
  // Broadcast.segmentId is SET NULL on delete: a draft loses its audience
  // rather than the segment being undeletable forever.
  await db.segment.delete({ where: { id } });
}

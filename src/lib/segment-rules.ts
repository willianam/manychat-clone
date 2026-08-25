import { z } from "zod";
import { canSend } from "./messaging-window";
import { compareValues } from "./field-values";

/**
 * Segment rules: the JSON stored in `Segment.rules`.
 *
 * Two evaluators share this shape. `segmentWhere` (server/segments.ts) turns
 * it into a Prisma where for everything Postgres can answer; `matchesSegment`
 * here answers the same question in memory for one contact. The second one
 * exists because two rules cannot be pushed to the database honestly:
 *
 *   - `window` is "can we send right now", which is `canSend`'s decision and
 *     must not be re-derived as a second cutoff that could drift from it;
 *   - ordered field comparisons (`gt`/`lt`/`before`/`after`) work on values
 *     stored as strings, and "9" < "10" only comes out right through
 *     `compareValues`.
 *
 * Everything else is pushed down, and the in-memory evaluator is the
 * reference the tests hold the where clause to.
 */

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "data inválida");

export const SegmentRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tag"), op: z.enum(["has", "missing"]), value: z.string().min(1) }),
  z.object({
    kind: z.literal("field"),
    key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    op: z.enum(["equals", "contains", "exists", "missing", "gt", "lt", "before", "after"]),
    value: z.string().optional(),
  }),
  z.object({
    kind: z.literal("lastInbound"),
    op: z.enum(["after", "before", "never"]),
    value: isoDate.optional(),
  }),
  z.object({
    kind: z.literal("source"),
    op: z.enum(["equals", "startsWith"]),
    value: z.string().min(1),
  }),
  z.object({ kind: z.literal("subscribed"), op: z.literal("is"), value: z.boolean() }),
  /** Inside / outside the 24h messaging window, as decided by `canSend`. */
  z.object({ kind: z.literal("window"), op: z.enum(["in", "out"]) }),
  z.object({ kind: z.literal("createdAt"), op: z.enum(["after", "before"]), value: isoDate }),
]);
export type SegmentRule = z.infer<typeof SegmentRule>;

export const SegmentRules = z.object({
  combinator: z.enum(["and", "or"]).default("and"),
  rules: z.array(SegmentRule).max(50).default([]),
});
export type SegmentRules = z.infer<typeof SegmentRules>;

export const EMPTY_RULES: SegmentRules = { combinator: "and", rules: [] };

/** Rules the database cannot evaluate — see the module comment. */
export function isMemoryRule(rule: SegmentRule): boolean {
  if (rule.kind === "window") return true;
  return rule.kind === "field" && ["gt", "lt", "before", "after"].includes(rule.op);
}

/**
 * What the in-memory evaluator needs of a contact. A subset of the Prisma
 * row plus the two relations, so callers select exactly this.
 */
export type SegmentContact = {
  lastInboundAt: Date | null;
  subscribed: boolean;
  source: string | null;
  createdAt: Date;
  tags: Array<{ tagId: string }>;
  fields: Array<{ key: string; value: string }>;
};

export function matchesRule(c: SegmentContact, rule: SegmentRule, now = new Date()): boolean {
  switch (rule.kind) {
    case "tag": {
      const has = c.tags.some((t) => t.tagId === rule.value);
      return rule.op === "has" ? has : !has;
    }
    case "field": {
      const f = c.fields.find((x) => x.key === rule.key);
      const v = f?.value;
      switch (rule.op) {
        case "exists":
          return v !== undefined && v !== "";
        case "missing":
          return v === undefined || v === "";
        case "equals":
          return (v ?? "").toLowerCase() === (rule.value ?? "").toLowerCase();
        case "contains":
          return (v ?? "").toLowerCase().includes((rule.value ?? "").toLowerCase());
        default:
          return v !== undefined && compareValues(rule.op, v, rule.value ?? "");
      }
    }
    case "lastInbound": {
      if (rule.op === "never") return c.lastInboundAt === null;
      if (!c.lastInboundAt) return false;
      const t = Date.parse(rule.value ?? "");
      return rule.op === "after" ? c.lastInboundAt.getTime() > t : c.lastInboundAt.getTime() < t;
    }
    case "source": {
      const s = c.source ?? "";
      return rule.op === "equals" ? s === rule.value : s.startsWith(rule.value);
    }
    case "subscribed":
      return c.subscribed === rule.value;
    case "window": {
      const allowed = canSend(c.lastInboundAt, { now }).allowed;
      return rule.op === "in" ? allowed : !allowed;
    }
    case "createdAt": {
      const t = Date.parse(rule.value);
      return rule.op === "after" ? c.createdAt.getTime() > t : c.createdAt.getTime() < t;
    }
  }
}

/** The whole rule set against one contact. No rules matches everyone. */
export function matchesSegment(c: SegmentContact, rules: SegmentRules, now = new Date()): boolean {
  if (rules.rules.length === 0) return true;
  return rules.combinator === "and"
    ? rules.rules.every((r) => matchesRule(c, r, now))
    : rules.rules.some((r) => matchesRule(c, r, now));
}

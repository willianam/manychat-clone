import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { segmentWhere, needsFilter, filterSegment, countSegment } from "../segments";
import { audienceOf, audienceWhere, resolveAudience, previewAudience } from "../broadcast-worker";
import {
  SegmentRules,
  matchesSegment,
  matchesRule,
  type SegmentContact,
  type SegmentRule,
} from "../../lib/segment-rules";

const NOW = new Date("2026-08-25T12:00:00Z");
const H = 3_600_000;

const rules = (combinator: "and" | "or", ...list: SegmentRule[]): SegmentRules => ({
  combinator,
  rules: list,
});

function contact(over: Partial<SegmentContact> = {}): SegmentContact {
  return {
    lastInboundAt: new Date(NOW.getTime() - 2 * H),
    subscribed: true,
    source: "dm",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    tags: [{ tagId: "t-vip" }],
    fields: [
      { key: "total", value: "1500" },
      { key: "cidade", value: "São Paulo" },
      { key: "nasc", value: "1990-05-20" },
    ],
    ...over,
  };
}

describe("SegmentRules schema", () => {
  it("defaults combinator and rules", () => {
    expect(SegmentRules.parse({})).toEqual({ combinator: "and", rules: [] });
  });

  it("rejects an unknown kind, a bad field key and a bad date", () => {
    expect(() => SegmentRules.parse({ rules: [{ kind: "nope", op: "x" }] })).toThrow();
    expect(() =>
      SegmentRules.parse({ rules: [{ kind: "field", key: "1x", op: "exists" }] }),
    ).toThrow();
    expect(() =>
      SegmentRules.parse({ rules: [{ kind: "createdAt", op: "after", value: "ontem" }] }),
    ).toThrow();
  });
});

describe("segmentWhere", () => {
  it("is empty for no rules", () => {
    expect(segmentWhere(rules("and"))).toEqual({});
  });

  it("tag has / missing", () => {
    expect(segmentWhere(rules("and", { kind: "tag", op: "has", value: "t1" }))).toEqual({
      AND: [{ tags: { some: { tagId: "t1" } } }],
    });
    expect(segmentWhere(rules("and", { kind: "tag", op: "missing", value: "t1" }))).toEqual({
      AND: [{ tags: { none: { tagId: "t1" } } }],
    });
  });

  it("field equals / contains are case-insensitive on the stored value", () => {
    expect(
      segmentWhere(rules("and", { kind: "field", key: "cidade", op: "equals", value: "sp" })),
    ).toEqual({
      AND: [{ fields: { some: { key: "cidade", value: { equals: "sp", mode: "insensitive" } } } }],
    });
    expect(
      segmentWhere(rules("and", { kind: "field", key: "cidade", op: "contains", value: "pau" })),
    ).toEqual({
      AND: [
        { fields: { some: { key: "cidade", value: { contains: "pau", mode: "insensitive" } } } },
      ],
    });
  });

  it("field exists / missing treat an empty string as missing", () => {
    expect(segmentWhere(rules("and", { kind: "field", key: "k", op: "exists" }))).toEqual({
      AND: [{ fields: { some: { key: "k", value: { not: "" } } } }],
    });
    expect(segmentWhere(rules("and", { kind: "field", key: "k", op: "missing" }))).toEqual({
      AND: [
        { OR: [{ fields: { none: { key: "k" } } }, { fields: { some: { key: "k", value: "" } } }] },
      ],
    });
  });

  it("ordered field comparisons and window are left to memory", () => {
    for (const op of ["gt", "lt", "before", "after"] as const) {
      const r = rules("and", { kind: "field", key: "total", op, value: "1" });
      expect(segmentWhere(r)).toEqual({});
      expect(needsFilter(r)).toBe(true);
    }
    const w = rules("and", { kind: "window", op: "in" });
    expect(segmentWhere(w)).toEqual({});
    expect(needsFilter(w)).toBe(true);
  });

  it("lastInbound after / before / never", () => {
    const iso = "2026-08-20T00:00:00.000Z";
    expect(segmentWhere(rules("and", { kind: "lastInbound", op: "after", value: iso }))).toEqual({
      AND: [{ lastInboundAt: { gt: new Date(iso) } }],
    });
    expect(segmentWhere(rules("and", { kind: "lastInbound", op: "before", value: iso }))).toEqual({
      AND: [{ lastInboundAt: { lt: new Date(iso) } }],
    });
    expect(segmentWhere(rules("and", { kind: "lastInbound", op: "never" }))).toEqual({
      AND: [{ lastInboundAt: null }],
    });
  });

  it("source, subscribed, createdAt", () => {
    expect(segmentWhere(rules("and", { kind: "source", op: "equals", value: "comment" }))).toEqual({
      AND: [{ source: "comment" }],
    });
    expect(segmentWhere(rules("and", { kind: "source", op: "startsWith", value: "ref:" }))).toEqual(
      { AND: [{ source: { startsWith: "ref:" } }] },
    );
    expect(segmentWhere(rules("and", { kind: "subscribed", op: "is", value: false }))).toEqual({
      AND: [{ subscribed: false }],
    });
    const iso = "2026-08-01T00:00:00.000Z";
    expect(segmentWhere(rules("and", { kind: "createdAt", op: "before", value: iso }))).toEqual({
      AND: [{ createdAt: { lt: new Date(iso) } }],
    });
  });

  it("AND keeps the pushable rules and drops memory ones (widening only)", () => {
    const w = segmentWhere(
      rules(
        "and",
        { kind: "tag", op: "has", value: "t1" },
        { kind: "window", op: "in" },
        { kind: "subscribed", op: "is", value: true },
      ),
    );
    expect(w).toEqual({ AND: [{ tags: { some: { tagId: "t1" } } }, { subscribed: true }] });
  });

  it("OR of pushable rules is an OR; OR with a memory rule pushes nothing", () => {
    expect(
      segmentWhere(
        rules(
          "or",
          { kind: "tag", op: "has", value: "t1" },
          { kind: "tag", op: "has", value: "t2" },
        ),
      ),
    ).toEqual({ OR: [{ tags: { some: { tagId: "t1" } } }, { tags: { some: { tagId: "t2" } } }] });

    expect(
      segmentWhere(
        rules("or", { kind: "tag", op: "has", value: "t1" }, { kind: "window", op: "out" }),
      ),
    ).toEqual({});
  });
});

describe("matchesRule / matchesSegment (the reference evaluator)", () => {
  const c = contact();

  it("tag", () => {
    expect(matchesRule(c, { kind: "tag", op: "has", value: "t-vip" })).toBe(true);
    expect(matchesRule(c, { kind: "tag", op: "missing", value: "t-vip" })).toBe(false);
    expect(matchesRule(c, { kind: "tag", op: "missing", value: "t-x" })).toBe(true);
  });

  it("field text ops", () => {
    expect(matchesRule(c, { kind: "field", key: "cidade", op: "equals", value: "são paulo" })).toBe(
      true,
    );
    expect(matchesRule(c, { kind: "field", key: "cidade", op: "contains", value: "PAULO" })).toBe(
      true,
    );
    expect(matchesRule(c, { kind: "field", key: "cidade", op: "exists" })).toBe(true);
    expect(matchesRule(c, { kind: "field", key: "zzz", op: "exists" })).toBe(false);
    expect(matchesRule(c, { kind: "field", key: "zzz", op: "missing" })).toBe(true);
    expect(
      matchesRule(contact({ fields: [{ key: "k", value: "" }] }), {
        kind: "field",
        key: "k",
        op: "missing",
      }),
    ).toBe(true);
  });

  it("field ordered ops compare as numbers and dates, not strings", () => {
    expect(matchesRule(c, { kind: "field", key: "total", op: "gt", value: "999" })).toBe(true);
    expect(matchesRule(c, { kind: "field", key: "total", op: "lt", value: "999" })).toBe(false);
    expect(matchesRule(c, { kind: "field", key: "nasc", op: "before", value: "01/01/2000" })).toBe(
      true,
    );
    expect(matchesRule(c, { kind: "field", key: "nasc", op: "after", value: "01/01/2000" })).toBe(
      false,
    );
    expect(matchesRule(c, { kind: "field", key: "zzz", op: "gt", value: "1" })).toBe(false);
  });

  it("lastInbound", () => {
    expect(
      matchesRule(c, { kind: "lastInbound", op: "after", value: "2026-08-25T00:00:00Z" }),
    ).toBe(true);
    expect(
      matchesRule(c, { kind: "lastInbound", op: "before", value: "2026-08-25T00:00:00Z" }),
    ).toBe(false);
    expect(matchesRule(c, { kind: "lastInbound", op: "never" })).toBe(false);
    const never = contact({ lastInboundAt: null });
    expect(matchesRule(never, { kind: "lastInbound", op: "never" })).toBe(true);
    expect(matchesRule(never, { kind: "lastInbound", op: "after", value: "2020-01-01" })).toBe(
      false,
    );
  });

  it("source / subscribed / createdAt", () => {
    expect(matchesRule(c, { kind: "source", op: "equals", value: "dm" })).toBe(true);
    expect(
      matchesRule(contact({ source: "ref:promo" }), {
        kind: "source",
        op: "startsWith",
        value: "ref:",
      }),
    ).toBe(true);
    expect(
      matchesRule(contact({ source: null }), { kind: "source", op: "equals", value: "dm" }),
    ).toBe(false);
    expect(matchesRule(c, { kind: "subscribed", op: "is", value: true })).toBe(true);
    expect(matchesRule(c, { kind: "createdAt", op: "after", value: "2026-07-01" })).toBe(true);
    expect(matchesRule(c, { kind: "createdAt", op: "before", value: "2026-07-01" })).toBe(false);
  });

  it("window follows canSend, with an injectable now", () => {
    expect(matchesRule(c, { kind: "window", op: "in" }, NOW)).toBe(true);
    expect(matchesRule(c, { kind: "window", op: "out" }, NOW)).toBe(false);
    const old = contact({ lastInboundAt: new Date(NOW.getTime() - 30 * H) });
    expect(matchesRule(old, { kind: "window", op: "in" }, NOW)).toBe(false);
    expect(matchesRule(contact({ lastInboundAt: null }), { kind: "window", op: "out" }, NOW)).toBe(
      true,
    );
  });

  it("combinators; no rules matches everyone", () => {
    expect(matchesSegment(c, rules("and"))).toBe(true);
    expect(
      matchesSegment(
        c,
        rules(
          "and",
          { kind: "tag", op: "has", value: "t-vip" },
          { kind: "tag", op: "has", value: "t-x" },
        ),
      ),
    ).toBe(false);
    expect(
      matchesSegment(
        c,
        rules(
          "or",
          { kind: "tag", op: "has", value: "t-vip" },
          { kind: "tag", op: "has", value: "t-x" },
        ),
      ),
    ).toBe(true);
  });
});

describe("filterSegment", () => {
  it("is a no-op without memory rules and filters with them", () => {
    const rows = [contact(), contact({ lastInboundAt: new Date(NOW.getTime() - 30 * H) })];
    expect(
      filterSegment(rows, rules("and", { kind: "tag", op: "has", value: "nope" }), NOW),
    ).toHaveLength(2);
    expect(filterSegment(rows, rules("and", { kind: "window", op: "in" }), NOW)).toHaveLength(1);
  });
});

function fakeDb(rows: Array<SegmentContact & { id: string }>) {
  const db = {
    contact: {
      findMany: vi.fn(async () => rows),
      count: vi.fn(async () => rows.length),
    },
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

describe("broadcast audience", () => {
  it("audienceOf prefers the segment over the tag filter", () => {
    expect(audienceOf({ filterTagIds: ["t1"], segment: null })).toEqual({ tagIds: ["t1"] });
    expect(
      audienceOf({
        filterTagIds: ["t1"],
        segment: { rules: { rules: [{ kind: "window", op: "in" }] } },
      }),
    ).toEqual({ rules: { combinator: "and", rules: [{ kind: "window", op: "in" }] } });
  });

  it("audienceWhere stays backwards compatible for tags and embeds the segment where", () => {
    expect(audienceWhere({ tagIds: ["t1"] }, NOW)).toEqual({
      subscribed: true,
      tags: { some: { tagId: { in: ["t1"] } } },
    });
    expect(
      audienceWhere(
        { tagIds: ["ignored"], rules: rules("and", { kind: "source", op: "equals", value: "dm" }) },
        NOW,
      ),
    ).toEqual({ subscribed: true, AND: [{ source: "dm" }] });
  });

  it("resolveAudience post-filters segment rows; previewAudience counts them in memory", async () => {
    const rows = [
      { id: "a", ...contact() },
      { id: "b", ...contact({ lastInboundAt: new Date(NOW.getTime() - 30 * H) }) },
    ];
    const { db, raw } = fakeDb(rows);
    const seg = rules("and", { kind: "window", op: "in" });

    expect((await resolveAudience(db, { rules: seg }, NOW)).map((r) => r.id)).toEqual(["a"]);

    const p = await previewAudience(db, { rules: seg }, NOW);
    expect(p).toEqual({ total: 1, inWindow: 1, outOfWindow: 0, mostlyOutOfWindow: false });
    expect(raw.contact.count).not.toHaveBeenCalled();

    // Pushable-only segments still count in the database.
    await previewAudience(
      db,
      { rules: rules("and", { kind: "subscribed", op: "is", value: true }) },
      NOW,
    );
    expect(raw.contact.count).toHaveBeenCalledTimes(2);

    expect(await countSegment(db, seg, NOW)).toBe(1);
  });
});

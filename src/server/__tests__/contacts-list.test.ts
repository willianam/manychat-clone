import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { parseContactQuery } from "../../lib/contact-query";
import { contactFilterWhere, contactOrderBy, contactsWhere, listContacts } from "../contacts-list";

const NOW = new Date("2026-08-25T12:00:00Z");
const H = 3_600_000;

describe("contactFilterWhere", () => {
  it("is empty without filters", () => {
    expect(contactFilterWhere(parseContactQuery({}), NOW)).toEqual({});
  });

  it("searches name and username, stripping a leading @", () => {
    const w = contactFilterWhere(parseContactQuery({ q: "@ana" }), NOW);
    expect(w).toEqual({
      AND: [
        {
          OR: [
            { name: { contains: "@ana", mode: "insensitive" } },
            { username: { contains: "ana", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("uses the same 24h cutoff as canSend for the window", () => {
    const cutoff = new Date(NOW.getTime() - 24 * H);
    expect(contactFilterWhere(parseContactQuery({ window: "in" }), NOW)).toEqual({
      AND: [{ lastInboundAt: { gte: cutoff } }],
    });
    expect(contactFilterWhere(parseContactQuery({ window: "out" }), NOW)).toEqual({
      AND: [{ OR: [{ lastInboundAt: null }, { lastInboundAt: { lt: cutoff } }] }],
    });
  });

  it("ANDs tags, subscription and source", () => {
    const w = contactFilterWhere(
      parseContactQuery({ tag: ["t1", "t2"], subscribed: "false", source: "dm" }),
      NOW,
    );
    expect(w).toEqual({
      AND: [
        { tags: { some: { tagId: "t1" } } },
        { tags: { some: { tagId: "t2" } } },
        { subscribed: false },
        { source: "dm" },
      ],
    });
  });
});

describe("contactOrderBy", () => {
  it("puts contacts who never wrote last when sorting by last interaction", () => {
    expect(contactOrderBy(parseContactQuery({}))).toEqual([
      { lastInboundAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ]);
  });
  it("sorts by name then username", () => {
    expect(contactOrderBy(parseContactQuery({ sort: "name" }))).toEqual([
      { name: { sort: "asc", nulls: "last" } },
      { username: "asc" },
    ]);
  });
});

function fakeDb(opts: { total?: number; segment?: { id: string; rules: unknown } | null } = {}) {
  const total = opts.total ?? 120;
  const all = Array.from({ length: total }, (_, i) => ({
    id: `c${i}`,
    lastInboundAt: i % 2 === 0 ? new Date(NOW.getTime() - 2 * H) : null,
    subscribed: true,
    source: "dm",
    createdAt: NOW,
    tags: [],
    fields: [{ key: "total", value: String(i) }],
  }));
  const db = {
    segment: { findUnique: vi.fn(async () => opts.segment ?? null) },
    contact: {
      count: vi.fn(async () => total),
      findMany: vi.fn(async ({ skip, take }: { skip?: number; take?: number }) =>
        all.slice(skip ?? 0, take === undefined ? undefined : (skip ?? 0) + take),
      ),
    },
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

describe("listContacts", () => {
  it("paginates 50 per page in the database and clamps the page", async () => {
    const { db, raw } = fakeDb({ total: 120 });
    const page = await listContacts(db, parseContactQuery({ page: "3" }), NOW);
    expect(page).toMatchObject({ total: 120, page: 3, pageSize: 50, pageCount: 3 });
    expect(page.rows).toHaveLength(20);
    expect(raw.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 50 }),
    );

    const clamped = await listContacts(db, parseContactQuery({ page: "9" }), NOW);
    expect(clamped.page).toBe(3);
  });
});

describe("contactsWhere", () => {
  it("pushes a database-only segment straight into the where", async () => {
    const { db } = fakeDb({
      segment: {
        id: "s1",
        rules: { combinator: "and", rules: [{ kind: "subscribed", op: "is", value: true }] },
      },
    });
    const w = await contactsWhere(db, parseContactQuery({ segment: "s1", source: "dm" }), NOW);
    expect(w).toEqual({ AND: [{ AND: [{ source: "dm" }] }, { AND: [{ subscribed: true }] }] });
  });

  it("resolves a memory-rule segment to an id list", async () => {
    const { db } = fakeDb({
      total: 4,
      segment: {
        id: "s1",
        rules: {
          combinator: "and",
          rules: [{ kind: "field", key: "total", op: "gt", value: "1" }],
        },
      },
    });
    const w = await contactsWhere(db, parseContactQuery({ segment: "s1" }), NOW);
    expect(w).toEqual({ id: { in: ["c2", "c3"] } });
  });

  it("ignores a segment that no longer exists", async () => {
    const { db } = fakeDb({ segment: null });
    expect(await contactsWhere(db, parseContactQuery({ segment: "gone" }), NOW)).toEqual({});
  });
});

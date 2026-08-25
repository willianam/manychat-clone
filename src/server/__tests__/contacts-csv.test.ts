import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { exportContactsCsv, importContactsCsv } from "../contacts-csv";
import { parseCsvRecords } from "../../lib/csv";

const CREATED = new Date("2026-08-01T00:00:00Z");

function fakeDb() {
  const contacts = [
    {
      id: "c1",
      igScopedId: "111",
      username: "ana",
      name: "Ana, a primeira",
      subscribed: true,
      createdAt: CREATED,
      tags: [{ tag: { id: "t-vip", name: "vip" } }],
      fields: [{ key: "cidade", value: "SP" }],
    },
    {
      id: "c2",
      igScopedId: "222",
      username: null,
      name: null,
      subscribed: false,
      createdAt: CREATED,
      tags: [],
      fields: [],
    },
  ];
  const db = {
    customField: {
      findMany: vi.fn(async () => [{ key: "cidade" }, { key: "idade" }]),
      upsert: vi.fn(async () => ({})),
    },
    contact: {
      findMany: vi.fn(async () => contacts),
      findUnique: vi.fn(
        async ({ where }: { where: { igScopedId: string } }) =>
          contacts.find((c) => c.igScopedId === where.igScopedId) ?? null,
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { username: string } }) =>
          contacts.find((c) => c.username === where.username) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
        Object.assign(
          contacts.find((c) => c.id === where.id)!,
          data,
        );
        return {};
      }),
    },
    tag: {
      upsert: vi.fn(async ({ where }: { where: { name: string } }) => ({
        id: `t-${where.name}`,
        name: where.name,
      })),
      findUnique: vi.fn(async ({ where }: { where: { name: string } }) => ({
        id: `t-${where.name}`,
        name: where.name,
      })),
    },
    contactTag: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    contactField: { upsert: vi.fn(async () => ({})) },
    contactEvent: { create: vi.fn(async () => ({})) },
    flowSession: { updateMany: vi.fn(async () => ({ count: 0 })) },
  };
  return { db: db as unknown as PrismaClient, raw: db, contacts };
}

describe("exportContactsCsv", () => {
  it("writes the fixed columns plus one per registered field", async () => {
    const { db } = fakeDb();
    const csv = await exportContactsCsv(db);
    const recs = parseCsvRecords(csv);
    expect(Object.keys(recs[0]!)).toEqual([
      "igScopedId",
      "username",
      "name",
      "tags",
      "subscribed",
      "createdAt",
      "field:cidade",
      "field:idade",
    ]);
    expect(recs[0]).toMatchObject({
      igScopedId: "111",
      name: "Ana, a primeira",
      tags: "vip",
      subscribed: "true",
      createdAt: CREATED.toISOString(),
      "field:cidade": "SP",
      "field:idade": "",
    });
    expect(recs[1]).toMatchObject({ igScopedId: "222", username: "", subscribed: "false" });
  });
});

describe("importContactsCsv", () => {
  it("updates by igScopedId, then by username, and never creates", async () => {
    const { db, raw, contacts } = fakeDb();
    const csv = [
      "igScopedId,username,name,tags,subscribed,field:idade",
      "111,ana,Ana Silva,vip|lead,,31",
      ",ana,,,,",
      "999,ghost,Fantasma,,,",
      "222,,,,sim,",
    ].join("\n");

    const report = await importContactsCsv(db, csv);

    expect(report).toMatchObject({ total: 4, updated: 3, skipped: ["999"], unknownColumns: [] });
    expect(contacts[0]!.name).toBe("Ana Silva");
    // tags: vip kept (no event), lead added
    expect(raw.contactTag.create).toHaveBeenCalledTimes(1);
    expect(raw.contactTag.deleteMany).not.toHaveBeenCalled();
    expect(raw.contactField.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { contactId: "c1", key: "idade", value: "31" } }),
    );
    // "sim" re-subscribes c2 and records it
    expect(raw.contact.update).toHaveBeenCalledWith({
      where: { id: "c2" },
      data: { subscribed: true, unsubscribedAt: null },
    });
    expect(raw.contactEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "SUBSCRIBED" }) }),
    );
  });

  it("a tags cell replaces the tag set; a blank one leaves it alone", async () => {
    const a = fakeDb();
    await importContactsCsv(a.db, "igScopedId,tags\n111,novo");
    expect(a.raw.contactTag.create).toHaveBeenCalledTimes(1);
    expect(a.raw.contactTag.deleteMany).toHaveBeenCalledTimes(1); // vip removed

    const b = fakeDb();
    await importContactsCsv(b.db, "igScopedId,tags\n111,");
    expect(b.raw.contactTag.create).not.toHaveBeenCalled();
    expect(b.raw.contactTag.deleteMany).not.toHaveBeenCalled();
  });
});

describe("importContactsCsv dry run", () => {
  it("matches every row and reports counts without writing", async () => {
    const { db, raw } = fakeDb();
    const csv = [
      "igScopedId,username,name,tags,subscribed,field:cidade,extra",
      "111,ana,Ana Maria,vip|novo,false,Recife,x",
      "999,,Ninguém,,,,",
      ",bruno,,,,,",
    ].join("\n");
    const report = await importContactsCsv(db, csv, { dryRun: true });
    expect(report).toEqual({
      total: 3,
      updated: 1,
      skipped: ["999", "bruno"],
      unknownColumns: ["extra"],
    });
    expect(raw.contact.update).not.toHaveBeenCalled();
    expect(raw.contactTag.create).not.toHaveBeenCalled();
    expect(raw.contactTag.deleteMany).not.toHaveBeenCalled();
    expect(raw.contactField.upsert).not.toHaveBeenCalled();
    expect(raw.contactEvent.create).not.toHaveBeenCalled();
    expect(raw.flowSession.updateMany).not.toHaveBeenCalled();

    const applied = await importContactsCsv(db, csv);
    expect(applied.updated).toBe(1);
    expect(raw.contact.update).toHaveBeenCalled();
    expect(raw.contactField.upsert).toHaveBeenCalled();
  });
});

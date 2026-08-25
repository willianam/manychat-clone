import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { fieldKeysInGraph, inferFieldType } from "../../lib/field-usage";
import {
  createCustomField,
  deleteCustomField,
  ensureCustomField,
  renameCustomField,
} from "../custom-fields";
import { saveContactField } from "../contact-fields";

const GRAPH = {
  nodes: [
    {
      id: "q1",
      type: "question",
      position: { x: 0, y: 0 },
      data: { kind: "question", text: "?", saveAs: "nome" },
    },
    {
      id: "qr",
      type: "quickreply",
      position: { x: 0, y: 0 },
      data: { kind: "quickreply", text: "?", saveAs: "plano", options: [{ id: "a", title: "A" }] },
    },
    {
      id: "a1",
      type: "action",
      position: { x: 0, y: 0 },
      data: {
        kind: "action",
        ops: [
          { op: "setField", key: "total", value: "1", valueType: "number" },
          { op: "unsetField", key: "temp" },
          { op: "addTag", tagName: "vip" },
        ],
      },
    },
    { id: "e", type: "end", position: { x: 0, y: 0 }, data: { kind: "end" } },
  ],
  edges: [],
};

function fakeDb(opts: { fields?: Array<{ id: string; key: string }>; flows?: object[] } = {}) {
  const fields = [...(opts.fields ?? [])];
  const db = {
    customField: {
      findMany: vi.fn(async () => fields),
      findUnique: vi.fn(
        async ({ where }: { where: { key?: string; id?: string } }) =>
          fields.find((f) => (where.key ? f.key === where.key : f.id === where.id)) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: "new", ...data })),
      update: vi.fn(async ({ data }: { data: object }) => ({ id: "x", ...data })),
      delete: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
    },
    flow: { findMany: vi.fn(async () => opts.flows ?? []) },
    contactField: { upsert: vi.fn(async () => ({})) },
    contactEvent: { create: vi.fn(async () => ({})) },
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

describe("fieldKeysInGraph", () => {
  it("collects saveAs and setField/unsetField keys, ignoring tags", () => {
    expect([...fieldKeysInGraph(GRAPH)].sort()).toEqual(["nome", "plano", "temp", "total"]);
  });

  it("tolerates a graph that is not a graph", () => {
    expect(fieldKeysInGraph(null).size).toBe(0);
    expect(fieldKeysInGraph({ nodes: "nope" }).size).toBe(0);
  });
});

describe("inferFieldType", () => {
  it("guesses from the value", () => {
    expect(inferFieldType("1.500,00")).toBe("number");
    expect(inferFieldType("25/08/2026")).toBe("date");
    expect(inferFieldType("true")).toBe("boolean");
    expect(inferFieldType("sim")).toBe("text");
    expect(inferFieldType("São Paulo")).toBe("text");
  });
});

describe("createCustomField", () => {
  it("creates with label defaulting to the key and the type upper-cased", async () => {
    const { db, raw } = fakeDb();
    await createCustomField(db, { key: "cidade", type: "text" });
    expect(raw.customField.create).toHaveBeenCalledWith({
      data: { key: "cidade", label: "cidade", type: "TEXT", defaultValue: null },
    });
  });

  it("rejects a bad key and a duplicate", async () => {
    const { db } = fakeDb({ fields: [{ id: "f1", key: "nome" }] });
    await expect(createCustomField(db, { key: "1abc" })).rejects.toThrow(/chave/);
    await expect(createCustomField(db, { key: "nome" })).rejects.toThrow(/já existe/);
  });
});

describe("renameCustomField", () => {
  it("changes only the label", async () => {
    const { db, raw } = fakeDb();
    await renameCustomField(db, "f1", "  Nome completo ");
    expect(raw.customField.update).toHaveBeenCalledWith({
      where: { id: "f1" },
      data: { label: "Nome completo" },
    });
  });
});

describe("deleteCustomField", () => {
  it("refuses while a flow writes the key", async () => {
    const { db, raw } = fakeDb({
      fields: [{ id: "f1", key: "total" }],
      flows: [{ id: "fl", name: "Vendas", graph: GRAPH }],
    });
    await expect(deleteCustomField(db, "f1")).rejects.toThrow(/Vendas/);
    expect(raw.customField.delete).not.toHaveBeenCalled();
  });

  it("deletes an unused key", async () => {
    const { db, raw } = fakeDb({
      fields: [{ id: "f1", key: "orfao" }],
      flows: [{ id: "fl", name: "Vendas", graph: GRAPH }],
    });
    await deleteCustomField(db, "f1");
    expect(raw.customField.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
  });
});

describe("auto-registration", () => {
  it("ensureCustomField upserts without touching an existing row", async () => {
    const { db, raw } = fakeDb();
    await ensureCustomField(db, "idade", "number");
    expect(raw.customField.upsert).toHaveBeenCalledWith({
      where: { key: "idade" },
      create: { key: "idade", label: "idade", type: "NUMBER" },
      update: {},
    });
  });

  it("saveContactField writes the value and registers the key with the declared or inferred type", async () => {
    const { db, raw } = fakeDb();
    await saveContactField(db, "c1", "total", "1500", "number");
    expect(raw.contactField.upsert).toHaveBeenCalledWith({
      where: { contactId_key: { contactId: "c1", key: "total" } },
      create: { contactId: "c1", key: "total", value: "1500" },
      update: { value: "1500" },
    });
    expect(raw.customField.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ type: "NUMBER" }) }),
    );

    await saveContactField(db, "c1", "nome", "Ana");
    expect(raw.customField.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ key: "nome", type: "TEXT" }) }),
    );
  });
});

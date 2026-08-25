import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { contactTimeline, addContactNote } from "../contact-timeline";
import {
  addTagToContact,
  removeTagFromContact,
  setContactSubscribed,
  recordContactEvent,
} from "../contact-events";

const t = (min: number) => new Date(Date.UTC(2026, 7, 25, 12, min));

function timelineDb(opts: { before?: Date } = {}) {
  const lt = opts.before;
  const older = <T extends { createdAt: Date }>(rows: T[]) =>
    rows.filter((r) => !lt || r.createdAt < lt);
  const messages = [
    { id: "m1", createdAt: t(1), direction: "INBOUND", text: "oi", status: "SENT", error: null },
    { id: "m2", createdAt: t(3), direction: "OUTBOUND", text: "olá", status: "SENT", error: null },
  ];
  const sessions = [
    {
      id: "s1",
      flowId: "f1",
      startedAt: t(2),
      updatedAt: t(5),
      status: "COMPLETED",
      flow: { name: "Boas-vindas" },
    },
    {
      id: "s2",
      flowId: "f2",
      startedAt: t(6),
      updatedAt: t(6),
      status: "WAITING_INPUT",
      flow: { name: "Quiz" },
    },
  ];
  const notes = [{ id: "n1", createdAt: t(4), text: "cliente antigo" }];
  const events = [{ id: "e1", createdAt: t(2), kind: "TAG_ADDED", payload: { tagName: "vip" } }];
  const db = {
    message: { findMany: vi.fn(async () => older(messages)) },
    flowSession: { findMany: vi.fn(async () => sessions) },
    contactNote: {
      findMany: vi.fn(async () => older(notes)),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: "n2", ...data })),
    },
    contactEvent: { findMany: vi.fn(async () => older(events)) },
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

describe("contactTimeline", () => {
  it("merges every source newest first, with a session start and its end", async () => {
    const { db } = timelineDb();
    const page = await contactTimeline(db, "c1");
    expect(page.items.map((i) => `${i.kind}@${i.at.getUTCMinutes()}`)).toEqual([
      "flow_started@6",
      "flow_completed@5",
      "note@4",
      "message@3",
      "flow_started@2",
      "event@2",
      "message@1",
    ]);
    expect(page.nextBefore).toBeNull();
  });

  it("paginates by timestamp and never repeats an item", async () => {
    const first = await contactTimeline(timelineDb().db, "c1", { limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextBefore).toEqual(t(4));

    const second = await contactTimeline(timelineDb({ before: t(4) }).db, "c1", {
      limit: 3,
      before: t(4),
    });
    expect(second.items.map((i) => i.at.getUTCMinutes())).toEqual([3, 2, 2]);
    // The finished session's end (t5) sits after `before` and is excluded
    // even though the session row itself was returned.
    expect(second.items.some((i) => i.kind === "flow_completed")).toBe(false);
  });

  it("addContactNote trims and refuses empty text", async () => {
    const { db, raw } = timelineDb();
    await addContactNote(db, "c1", "  ligar amanhã ");
    expect(raw.contactNote.create).toHaveBeenCalledWith({
      data: { contactId: "c1", text: "ligar amanhã" },
    });
    await expect(addContactNote(db, "c1", "   ")).rejects.toThrow();
  });
});

function eventsDb(opts: { hasTag?: boolean; subscribed?: boolean } = {}) {
  const db = {
    tag: {
      upsert: vi.fn(async () => ({ id: "t1", name: "vip" })),
      findUnique: vi.fn(async () => ({ id: "t1", name: "vip" })),
    },
    contactTag: {
      findUnique: vi.fn(async () => (opts.hasTag ? { contactId: "c1", tagId: "t1" } : null)),
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: opts.hasTag ? 1 : 0 })),
    },
    contact: {
      findUnique: vi.fn(async () => ({ subscribed: opts.subscribed ?? true })),
      update: vi.fn(async () => ({})),
    },
    flowSession: { updateMany: vi.fn(async () => ({ count: 0 })) },
    contactEvent: { create: vi.fn(async () => ({})) },
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

describe("contact events at the mutation sites", () => {
  it("adding a tag records TAG_ADDED once, not again when already present", async () => {
    const a = eventsDb();
    await addTagToContact(a.db, "c1", "vip", "flow");
    expect(a.raw.contactTag.create).toHaveBeenCalledTimes(1);
    expect(a.raw.contactEvent.create).toHaveBeenCalledWith({
      data: {
        contactId: "c1",
        kind: "TAG_ADDED",
        payload: { tagId: "t1", tagName: "vip", via: "flow" },
      },
    });

    const b = eventsDb({ hasTag: true });
    await addTagToContact(b.db, "c1", "vip", "flow");
    expect(b.raw.contactTag.create).not.toHaveBeenCalled();
    expect(b.raw.contactEvent.create).not.toHaveBeenCalled();
  });

  it("removing a tag records TAG_REMOVED only when a row was deleted", async () => {
    const a = eventsDb({ hasTag: true });
    await removeTagFromContact(a.db, "c1", "vip", "panel");
    expect(a.raw.contactEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "TAG_REMOVED" }) }),
    );
    const b = eventsDb({ hasTag: false });
    await removeTagFromContact(b.db, "c1", "vip", "panel");
    expect(b.raw.contactEvent.create).not.toHaveBeenCalled();
  });

  it("unsubscribing abandons open sessions and records UNSUBSCRIBED; no event when unchanged", async () => {
    const a = eventsDb({ subscribed: true });
    await setContactSubscribed(a.db, "c1", false, "panel");
    expect(a.raw.contact.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { subscribed: false, unsubscribedAt: expect.any(Date) },
    });
    expect(a.raw.flowSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "ABANDONED", abandonedAt: expect.any(Date) },
      }),
    );
    expect(a.raw.contactEvent.create).toHaveBeenCalledWith({
      data: { contactId: "c1", kind: "UNSUBSCRIBED", payload: { via: "panel" } },
    });

    const b = eventsDb({ subscribed: true });
    await setContactSubscribed(b.db, "c1", true, "panel");
    expect(b.raw.flowSession.updateMany).not.toHaveBeenCalled();
    expect(b.raw.contactEvent.create).not.toHaveBeenCalled();
  });

  it("a failed event write is logged, not thrown", async () => {
    const { db, raw } = eventsDb();
    raw.contactEvent.create.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordContactEvent(db, "c1", "FIELD_SET", { key: "k" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

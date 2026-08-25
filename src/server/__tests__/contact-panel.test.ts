import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  abandonSession,
  humanAgentAllowed,
  sendPanelMessage,
  setContactFieldFromPanel,
  unsetContactFieldFromPanel,
} from "../contact-panel";

vi.mock("../instagram", () => ({ sendText: vi.fn(async () => undefined) }));
import { sendText } from "../instagram";

const NOW = Date.now();
const H = 3_600_000;

function fakeDb(
  opts: { fieldType?: "TEXT" | "NUMBER" | "DATE" | "BOOLEAN"; lastInboundAt?: Date | null } = {},
) {
  const db = {
    customField: {
      findUnique: vi.fn(async () =>
        opts.fieldType ? { id: "f1", key: "total", type: opts.fieldType } : null,
      ),
      upsert: vi.fn(async () => ({})),
    },
    contactField: {
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    contactEvent: { create: vi.fn(async () => ({})) },
    flowSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
    contact: {
      findUnique: vi.fn(async () => ({
        lastInboundAt:
          opts.lastInboundAt === undefined ? new Date(NOW - 2 * H) : opts.lastInboundAt,
        subscribed: true,
      })),
    },
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

describe("setContactFieldFromPanel", () => {
  it("coerces to the registered type before saving", async () => {
    const { db, raw } = fakeDb({ fieldType: "NUMBER" });
    expect(await setContactFieldFromPanel(db, "c1", "total", "1.500,50")).toBe("1500.5");
    expect(raw.contactField.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: "1500.5" } }),
    );
    expect(raw.contactEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kind: "FIELD_SET" }) }),
    );
  });

  it("refuses an unregistered key", async () => {
    const { db } = fakeDb();
    await expect(setContactFieldFromPanel(db, "c1", "nope", "x")).rejects.toThrow(
      /não está registrado/,
    );
  });
});

describe("unsetContactFieldFromPanel", () => {
  it("deletes and records an empty FIELD_SET", async () => {
    const { db, raw } = fakeDb();
    await unsetContactFieldFromPanel(db, "c1", "total");
    expect(raw.contactField.deleteMany).toHaveBeenCalledWith({
      where: { contactId: "c1", key: "total" },
    });
    expect(raw.contactEvent.create).toHaveBeenCalledWith({
      data: { contactId: "c1", kind: "FIELD_SET", payload: { key: "total", value: "" } },
    });
  });
});

describe("abandonSession", () => {
  it("only touches open sessions", async () => {
    const { db, raw } = fakeDb();
    expect(await abandonSession(db, "s1")).toBe(true);
    expect(raw.flowSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1", status: { in: ["ACTIVE", "WAITING_INPUT"] } },
      }),
    );
  });
});

describe("sendPanelMessage", () => {
  it("sends plainly inside the window", async () => {
    const { db } = fakeDb();
    expect(await sendPanelMessage(db, "c1", "  oi  ")).toEqual({ tag: undefined });
    expect(sendText).toHaveBeenLastCalledWith(db, "c1", "oi", { tag: undefined });
  });

  it("refuses outside the window without the tag, in Portuguese", async () => {
    const { db } = fakeDb({ lastInboundAt: new Date(NOW - 30 * H) });
    await expect(sendPanelMessage(db, "c1", "oi")).rejects.toThrow(/24 horas/);
  });

  it("uses HUMAN_AGENT outside the window when asked and allowed", async () => {
    const { db } = fakeDb({ lastInboundAt: new Date(NOW - 30 * H) });
    const r = await sendPanelMessage(db, "c1", "oi", { humanAgent: true, env: {} });
    expect(r).toEqual({ tag: "HUMAN_AGENT" });
    expect(sendText).toHaveBeenLastCalledWith(db, "c1", "oi", { tag: "HUMAN_AGENT" });
  });

  it("ignores the request when the deployment turned HUMAN_AGENT off", async () => {
    const { db } = fakeDb({ lastInboundAt: new Date(NOW - 30 * H) });
    await expect(
      sendPanelMessage(db, "c1", "oi", { humanAgent: true, env: { HUMAN_AGENT: "off" } }),
    ).rejects.toThrow(/24 horas/);
    expect(humanAgentAllowed({ HUMAN_AGENT: "off" })).toBe(false);
    expect(humanAgentAllowed({})).toBe(true);
  });

  it("never sends to a contact who never wrote", async () => {
    const { db } = fakeDb({ lastInboundAt: null });
    await expect(sendPanelMessage(db, "c1", "oi", { humanAgent: true, env: {} })).rejects.toThrow(
      /nunca escreveu/,
    );
  });

  it("rejects an empty message before touching the database", async () => {
    const { db, raw } = fakeDb();
    await expect(sendPanelMessage(db, "c1", "   ")).rejects.toThrow(/Escreva/);
    expect(raw.contact.findUnique).not.toHaveBeenCalled();
  });
});

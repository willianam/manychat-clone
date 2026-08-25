import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { BroadcastContent, parseBroadcastBody } from "../../lib/broadcast-content";
import { parseBroadcastForm } from "../../lib/broadcast-form";
import { broadcastPayload } from "../broadcast-payload";

vi.mock("../instagram", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));
vi.mock("../flow-runner", () => ({ startFlow: vi.fn() }));

import { sendMessage } from "../instagram";
import { startFlow } from "../flow-runner";
import { runBroadcast } from "../broadcast-worker";

const NOW = new Date();

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("BroadcastContent", () => {
  it("accepts sending nodes and rejects silent ones", () => {
    expect(BroadcastContent.parse({ kind: "image", url: "https://x/a.png" }).kind).toBe("image");
    expect(() => BroadcastContent.parse({ kind: "delay", seconds: 10 })).toThrow();
    expect(() => BroadcastContent.parse({ kind: "end" })).toThrow();
  });

  it("parseBroadcastBody prefers flow, then content, then text", () => {
    expect(parseBroadcastBody({ text: "oi", content: null, flowId: "f1" })).toEqual({
      kind: "flow",
      flowId: "f1",
    });
    expect(
      parseBroadcastBody({ text: "oi", content: { kind: "message", text: "b" }, flowId: null }),
    ).toMatchObject({ kind: "content" });
    expect(parseBroadcastBody({ text: "oi", content: null, flowId: null })).toEqual({
      kind: "text",
      text: "oi",
    });
    expect(() => parseBroadcastBody({ text: null, content: null, flowId: null })).toThrow();
  });
});

describe("broadcastPayload", () => {
  it("builds a button template with the broadcast id as postback prefix", () => {
    const { payload, preview } = broadcastPayload("b1", {
      kind: "message",
      text: "Promo",
      buttons: [{ type: "postback", id: "x", title: "Quero" }],
    });
    expect(preview).toBe("Promo");
    expect(JSON.stringify(payload)).toContain('"payload":"b1:x"');
  });

  it("builds media and album payloads", () => {
    expect(broadcastPayload("b", { kind: "video", url: "https://x/v.mp4" }).payload).toEqual({
      attachment: { type: "video", payload: { url: "https://x/v.mp4", is_reusable: true } },
    });
    expect(
      broadcastPayload("b", { kind: "album", urls: ["https://x/1.png"] }).payload,
    ).toHaveProperty("attachments");
  });
});

describe("parseBroadcastForm bodies", () => {
  it("keeps the plain-text composer working", () => {
    expect(parseBroadcastForm(form({ text: "oi" }))).toMatchObject({
      text: "oi",
      content: null,
      flowId: null,
    });
  });

  it("accepts a content block or a flow without text, and rejects nothing at all", () => {
    const c = parseBroadcastForm(form({ content: JSON.stringify({ kind: "message", text: "x" }) }));
    expect(c.text).toBeNull();
    expect(c.content).toEqual({ kind: "message", text: "x" });
    expect(parseBroadcastForm(form({ flowId: "f1" })).flowId).toBe("f1");
    expect(() => parseBroadcastForm(form({}))).toThrow(/vazia/);
    expect(() => parseBroadcastForm(form({ content: "{nope" }))).toThrow(/JSON/);
  });
});

function fakeDb(broadcast: Record<string, unknown>) {
  const b = { id: "b1", status: "QUEUED", lockedAt: null, ...broadcast };
  const recipients = [
    { id: "r1", contactId: "c1", status: "PENDING", contact: { lastInboundAt: NOW } },
  ];
  const db = {
    broadcast: {
      findUniqueOrThrow: vi.fn(async () => ({ ...b })),
      updateMany: vi.fn(async ({ data }: { data: object }) => {
        Object.assign(b, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: object }) => Object.assign(b, data)),
    },
    broadcastRecipient: {
      findMany: vi.fn(async () => recipients),
      update: vi.fn(async ({ data }: { data: object }) => {
        Object.assign(recipients[0]!, data);
        return {};
      }),
    },
  };
  return { db: db as unknown as PrismaClient, raw: db, recipients };
}

beforeEach(() => {
  vi.mocked(sendMessage).mockClear();
  vi.mocked(startFlow).mockReset();
});

describe("runBroadcast bodies", () => {
  it("sends a text body through sendMessage", async () => {
    const { db } = fakeDb({ text: "oi", content: null, flowId: null });
    const r = await runBroadcast(db, "b1");
    expect(r).toMatchObject({ sent: 1 });
    expect(sendMessage).toHaveBeenCalledWith(db, "c1", { text: "oi" }, { preview: "oi" });
  });

  it("sends a content block through the payload builders", async () => {
    const { db } = fakeDb({
      text: null,
      content: { kind: "image", url: "https://x/a.png", caption: "veja" },
      flowId: null,
    });
    await runBroadcast(db, "b1");
    expect(sendMessage).toHaveBeenCalledWith(
      db,
      "c1",
      { attachment: { type: "image", payload: { url: "https://x/a.png", is_reusable: true } } },
      { preview: "veja" },
    );
  });

  it("starts a flow per recipient and fails the row when the flow will not start", async () => {
    vi.mocked(startFlow).mockResolvedValueOnce({ status: "completed" });
    const a = fakeDb({ text: null, content: null, flowId: "f1" });
    expect(await runBroadcast(a.db, "b1")).toMatchObject({ sent: 1, failed: 0 });
    expect(startFlow).toHaveBeenCalledWith(a.db, "f1", "c1");
    expect(sendMessage).not.toHaveBeenCalled();

    vi.mocked(startFlow).mockResolvedValueOnce(null);
    const b = fakeDb({ text: null, content: null, flowId: "f1" });
    expect(await runBroadcast(b.db, "b1")).toMatchObject({ sent: 0, failed: 1 });
    expect(b.recipients[0]).toMatchObject({
      status: "FAILED",
      error: expect.stringMatching(/Fluxo/),
    });
  });
});

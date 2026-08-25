import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/**
 * Every write that parks the session on a node must carry the context with
 * it. Six branches (carousel, image, video/audio/file, album, tag, condition)
 * used to persist only `currentNodeId`. A field captured by a request or
 * action node before one of those was lost if the process died there, and the
 * next `{{field}}` rendered empty.
 */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendMessage } from "../instagram";
import { startFlow } from "../flow-runner";

const CONTACT = "contact-1";
const FLOW = "flow-1";
const node = (id: string, data: object) => ({
  id,
  type: (data as { kind: string }).kind,
  position: { x: 0, y: 0 },
  data,
});

function fakeDb(graph: object) {
  const session = {
    id: "s1",
    flowId: FLOW,
    contactId: CONTACT,
    currentNodeId: null,
    status: "ACTIVE",
    context: {},
    resumeAt: null,
  } as unknown as FlowSession;
  const updates: Array<Record<string, unknown>> = [];
  const write = ({ data }: { data: Record<string, unknown> }) => {
    updates.push(data);
    Object.assign(session, data);
    return Promise.resolve({ ...session });
  };
  const db = {
    contact: { findUnique: vi.fn().mockResolvedValue({ id: CONTACT, subscribed: true }) },
    flow: { findUnique: vi.fn().mockResolvedValue({ id: FLOW, enabled: true, graph }) },
    flowSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(write),
      update: vi.fn(write),
    },
    contactField: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    customField: { upsert: vi.fn().mockResolvedValue({}) },
    contactEvent: { create: vi.fn().mockResolvedValue({}) },
    contactTag: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db: db as unknown as PrismaClient, session, updates };
}

const texts = () =>
  vi.mocked(sendMessage).mock.calls.map((c) => String((c[2] as { text?: string }).text ?? ""));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(sendMessage).mockClear();
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ data: { price: 99.9 } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** request (captures `preco`) -> image -> message that renders `preco`. */
const SEQUENCE = {
  nodes: [
    node("r", {
      kind: "request",
      method: "GET",
      url: "https://api.exemplo.com/q",
      mapping: [{ path: "data.price", field: "preco" }],
    }),
    node("img", { kind: "image", url: "https://cdn.exemplo.com/a.png" }),
    node("m", { kind: "message", text: "preço {{preco}}" }),
    node("e", { kind: "end" }),
  ],
  edges: [
    { id: "r-img", source: "r", target: "img", sourceHandle: "success" },
    { id: "img-m", source: "img", target: "m" },
    { id: "m-e", source: "m", target: "e" },
  ],
};

describe("session context survives every persist", () => {
  it("keeps a captured field across an image node", async () => {
    const { db, updates } = fakeDb(SEQUENCE);
    await startFlow(db, FLOW, CONTACT);

    // The value still renders downstream.
    expect(texts()).toContain("preço 99.9");

    // And, the real point: the write that parked us on the image node
    // carried the context, so a crash there would not have lost it.
    const atImage = updates.filter((u) => u.currentNodeId === "m");
    expect(atImage.length).toBeGreaterThan(0);
    for (const u of atImage) {
      expect(u.context).toMatchObject({ preco: "99.9" });
    }
  });

  it("no write parks the session on a node without its context", async () => {
    const { db, updates } = fakeDb(SEQUENCE);
    await startFlow(db, FLOW, CONTACT);

    // Once context is non-empty, every subsequent positional write must
    // include it. A write that moves the cursor and omits context is the bug.
    let seen = false;
    for (const u of updates) {
      if (u.context && Object.keys(u.context as object).length > 0) seen = true;
      if (!seen) continue;
      if (!("currentNodeId" in u)) continue;
      if (u.currentNodeId === null) continue; // terminal write
      expect(u).toHaveProperty("context");
    }
    expect(seen).toBe(true);
  });
});

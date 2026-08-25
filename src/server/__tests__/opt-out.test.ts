import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/**
 * Guards opt-out end to end: the global keyword wins over a waiting
 * question, an opted-out contact starts no flow from any entry point, and
 * the action-node op flips the same flag.
 */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendText } from "../instagram";
import { startFlow } from "../flow-runner";
import { handleInboundMessage, handleStoryReply } from "../trigger-dispatch";

const CONTACT = "contact-1";
const FLOW = "flow-1";

const node = (id: string, data: object) => ({
  id,
  type: (data as { kind: string }).kind,
  position: { x: 0, y: 0 },
  data,
});
const chain = (...nodes: ReturnType<typeof node>[]) => ({
  nodes,
  edges: nodes
    .slice(1)
    .map((n, i) => ({ id: `${nodes[i]!.id}-${n.id}`, source: nodes[i]!.id, target: n.id })),
});

const REPLYING_GRAPH = chain(
  node("m1", { kind: "message", text: "olá" }),
  node("e1", { kind: "end" }),
);
const UNSUBSCRIBE_GRAPH = chain(
  node("a1", { kind: "action", ops: [{ op: "unsubscribe" }] }),
  node("m1", { kind: "message", text: "até logo" }),
  node("e1", { kind: "end" }),
);
const RESUBSCRIBE_GRAPH = chain(
  node("a1", { kind: "action", ops: [{ op: "resubscribe" }] }),
  node("e1", { kind: "end" }),
);

function fakeDb(opts: { graph?: object; subscribed?: boolean; waiting?: boolean } = {}) {
  const contact = { id: CONTACT, subscribed: opts.subscribed ?? true };
  const waiting: FlowSession | null = opts.waiting
    ? ({
        id: "s-wait",
        flowId: FLOW,
        contactId: CONTACT,
        currentNodeId: "q1",
        status: "WAITING_INPUT",
        context: {},
      } as unknown as FlowSession)
    : null;
  const session = {
    id: "s-new",
    flowId: FLOW,
    contactId: CONTACT,
    currentNodeId: null,
    status: "ACTIVE",
    context: {},
  };
  const write = ({ data }: { data: object }) => {
    Object.assign(session, data);
    return Promise.resolve({ ...session });
  };
  const flowRow = opts.graph ? { id: FLOW, enabled: true, graph: opts.graph } : null;

  const db = {
    contact: {
      findUnique: vi.fn(async () => ({ ...contact })),
      update: vi.fn(async ({ data }: { data: Partial<typeof contact> }) => {
        Object.assign(contact, data);
        return { ...contact };
      }),
    },
    flow: {
      findUnique: vi.fn().mockResolvedValue(flowRow),
      findUniqueOrThrow: vi.fn().mockResolvedValue(flowRow),
    },
    flowSession: {
      findFirst: vi.fn(async ({ where }: { where: { status?: unknown } }) =>
        where.status === "WAITING_INPUT" ? waiting : null,
      ),
      updateMany: vi.fn().mockResolvedValue({ count: waiting ? 1 : 0 }),
      create: vi.fn(write),
      update: vi.fn(write),
    },
    trigger: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          {
            id: "trg-1",
            flowId: FLOW,
            kind: "KEYWORD",
            pattern: "preco",
            match: "CONTAINS",
            enabled: true,
            priority: 0,
          },
        ]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    unmatchedMessage: { upsert: vi.fn().mockResolvedValue({}) },
    contactField: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;

  return { db, contact };
}

const sentTexts = () => vi.mocked(sendText).mock.calls.map((c) => c[2]);

beforeEach(() => {
  vi.mocked(sendText).mockClear();
});

describe("opt-out keyword", () => {
  it("unsubscribes, abandons every open session and confirms, without touching triggers", async () => {
    const { db, contact } = fakeDb({ graph: REPLYING_GRAPH, waiting: true });

    await handleInboundMessage(db, CONTACT, "PARAR");

    expect(contact.subscribed).toBe(false);
    expect(db.flowSession.updateMany).toHaveBeenCalledWith({
      where: { contactId: CONTACT, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
      data: { status: "ABANDONED" },
    });
    expect(sentTexts()).toHaveLength(1);
    expect(sentTexts()[0]).toContain("voltar");
    // The waiting question did not consume the word, and no trigger ran.
    expect(db.flow.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(db.trigger.findMany).not.toHaveBeenCalled();
    expect(db.flowSession.create).not.toHaveBeenCalled();
  });

  it("applies to story replies the same way", async () => {
    const { db, contact } = fakeDb({ graph: REPLYING_GRAPH });

    await handleStoryReply(db, CONTACT, "sair");

    expect(contact.subscribed).toBe(false);
    expect(sentTexts()).toHaveLength(1);
  });

  it("still opts out when the confirmation cannot be sent", async () => {
    vi.mocked(sendText).mockRejectedValueOnce(new Error("window closed"));
    const { db, contact } = fakeDb();

    await expect(handleInboundMessage(db, CONTACT, "stop")).resolves.toBeUndefined();
    expect(contact.subscribed).toBe(false);
  });
});

describe("an opted-out contact", () => {
  it("does not start a flow by keyword, and is not counted as an unmatched message", async () => {
    const { db } = fakeDb({ graph: REPLYING_GRAPH, subscribed: false });

    await handleInboundMessage(db, CONTACT, "qual o preço?");

    expect(db.flowSession.create).not.toHaveBeenCalled();
    expect(db.unmatchedMessage.upsert).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("cannot be started into a flow from any entry point", async () => {
    const { db } = fakeDb({ graph: REPLYING_GRAPH, subscribed: false });

    await expect(startFlow(db, FLOW, CONTACT)).resolves.toBeNull();
    expect(db.flowSession.create).not.toHaveBeenCalled();
  });

  it("comes back with 'voltar'", async () => {
    const { db, contact } = fakeDb({ graph: REPLYING_GRAPH, subscribed: false });

    await handleInboundMessage(db, CONTACT, "voltar");

    expect(contact.subscribed).toBe(true);
    expect(sentTexts()).toHaveLength(1);
    expect(db.flowSession.updateMany).not.toHaveBeenCalled();
  });
});

describe("action node ops", () => {
  it("unsubscribe flips the flag and lets the flow finish what it was saying", async () => {
    const { db, contact } = fakeDb({ graph: UNSUBSCRIBE_GRAPH });

    const out = await startFlow(db, FLOW, CONTACT);

    expect(out).toEqual({ status: "completed" });
    expect(contact.subscribed).toBe(false);
    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: CONTACT },
      data: { subscribed: false, unsubscribedAt: expect.any(Date) },
    });
  });

  it("resubscribe flips it back", async () => {
    const { db, contact } = fakeDb({ graph: RESUBSCRIBE_GRAPH });
    contact.subscribed = true; // startFlow needs a subscribed contact to run at all

    await startFlow(db, FLOW, CONTACT);

    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: CONTACT },
      data: { subscribed: true, unsubscribedAt: null },
    });
  });
});

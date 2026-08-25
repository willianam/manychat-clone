import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/**
 * Guards WHEN the read receipt is sent. The webhook used to mark every
 * inbound DM as seen before knowing whether any flow would answer; unhandled
 * messages then looked read and the account owner missed them. The receipt
 * now belongs to the flow-runner: sent once per inbound message, only when a
 * node is about to reply, right before its typing bubble. A run resumed
 * after a delay does not repeat it; a run answering a fresh reply does.
 */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendMessage, sendSenderActionToContact } from "../instagram";
import { startFlow, resumeDelayed, resumeWithInput } from "../flow-runner";
import { handleInboundMessage } from "../trigger-dispatch";
import { tickDelayedSessions } from "../broadcast-worker";

const senderAction = vi.mocked(sendSenderActionToContact);

const CONTACT = "contact-1";
const FLOW = "flow-1";

const node = (id: string, data: object, type = (data as { kind: string }).kind) => ({
  id, type, position: { x: 0, y: 0 }, data,
});
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });
const chain = (...nodes: ReturnType<typeof node>[]) => ({
  nodes,
  edges: nodes.slice(1).map((n, i) => edge(nodes[i]!.id, n.id)),
});

/** message → end: a flow that replies. */
const REPLYING_GRAPH = chain(node("m1", { kind: "message", text: "olá" }), node("e1", { kind: "end" }));

/** message → message → end: two sends, still one receipt. */
const TWO_MESSAGE_GRAPH = chain(
  node("m1", { kind: "message", text: "oi" }),
  node("m2", { kind: "message", text: "tudo bem?" }),
  node("e1", { kind: "end" }),
);

/** tag → end: a flow that runs but never sends anything. */
const SILENT_GRAPH = chain(node("t1", { kind: "tag", tagName: "lead", action: "add" }), node("e1", { kind: "end" }));

/** message → delay → message → end. */
const MESSAGE_DELAY_MESSAGE_GRAPH = chain(
  node("m1", { kind: "message", text: "já volto" }),
  node("d1", { kind: "delay", seconds: 60 }),
  node("m2", { kind: "message", text: "voltei" }),
  node("e1", { kind: "end" }),
);

/** delay → message → end: nothing is sent before the park. */
const DELAY_MESSAGE_GRAPH = chain(
  node("d1", { kind: "delay", seconds: 60 }),
  node("m1", { kind: "message", text: "depois" }),
  node("e1", { kind: "end" }),
);

/** question → message → end: the reply is a new inbound message. */
const QUESTION_GRAPH = chain(
  node("q1", { kind: "question", text: "Seu nome?", saveAs: "name" }),
  node("m1", { kind: "message", text: "prazer" }),
  node("e1", { kind: "end" }),
);

/**
 * The smallest Prisma stand-in the runner, dispatcher and worker touch.
 * One live session row: create/update write into it and echo it back, as
 * Prisma does, so a test can hand the parked session to the next run.
 */
function fakeDb(opts: { graph?: object; trigger?: boolean } = {}) {
  const session: FlowSession = {
    id: "session-1", flowId: FLOW, contactId: CONTACT, currentNodeId: null,
    status: "ACTIVE", context: {}, resumeAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  } as unknown as FlowSession;
  const write = ({ data }: { data: object }) => {
    Object.assign(session, data);
    return Promise.resolve({ ...session });
  };
  const flowRow = opts.graph ? { id: FLOW, enabled: true, graph: opts.graph } : null;

  const db = {
    flow: {
      findUnique: vi.fn().mockResolvedValue(flowRow),
      findUniqueOrThrow: vi.fn().mockResolvedValue(flowRow),
    },
    flowSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(() => Promise.resolve([{ ...session }])),
      create: vi.fn(write),
      update: vi.fn(write),
    },
    trigger: {
      findMany: vi.fn().mockResolvedValue(
        opts.trigger
          ? [{ id: "trg-1", flowId: FLOW, kind: "KEYWORD", pattern: "preço", match: "CONTAINS", enabled: true, priority: 0 }]
          : [],
      ),
      findFirst: vi.fn().mockResolvedValue(null), // no DEFAULT fallback trigger
    },
    unmatchedMessage: { upsert: vi.fn().mockResolvedValue({}) },
    contact: { findUnique: vi.fn().mockResolvedValue({ id: CONTACT, subscribed: true }) },
    contactField: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({}) },
    tag: { upsert: vi.fn().mockResolvedValue({ id: "tag-1", name: "lead" }) },
    contactTag: { upsert: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaClient;

  return { db, session };
}

const actionsSent = () => senderAction.mock.calls.map(([, , action]) => action);
const textsSent = () => vi.mocked(sendMessage).mock.calls.map((c) => JSON.stringify(c[2]));

beforeEach(() => {
  senderAction.mockClear();
  vi.mocked(sendMessage).mockClear();
});

describe("mark_seen is sent by the flow-runner, not the webhook", () => {
  it("an inbound message with no matching keyword and no flow sends NO mark_seen", async () => {
    const { db } = fakeDb();

    await handleInboundMessage(db, CONTACT, "mensagem sem gatilho");

    expect(actionsSent()).not.toContain("mark_seen");
    expect(senderAction).not.toHaveBeenCalled();
  });

  it("an inbound message that starts a flow sends mark_seen, right before typing_on", async () => {
    const { db } = fakeDb({ graph: REPLYING_GRAPH, trigger: true });

    await handleInboundMessage(db, CONTACT, "qual o preço?");

    expect(actionsSent()).toEqual(["mark_seen", "typing_on"]);
    expect(senderAction).toHaveBeenCalledWith(db, CONTACT, "mark_seen");
  });

  it("sends mark_seen only once per run, even when the flow sends several messages", async () => {
    const { db } = fakeDb({ graph: TWO_MESSAGE_GRAPH });

    await startFlow(db, FLOW, CONTACT);

    expect(actionsSent()).toEqual(["mark_seen", "typing_on", "typing_on"]);
  });

  it("a flow that runs but never replies does not mark the message as seen", async () => {
    const { db } = fakeDb({ graph: SILENT_GRAPH });

    await startFlow(db, FLOW, CONTACT);

    expect(senderAction).not.toHaveBeenCalled();
  });
});

describe("mark_seen across a delay", () => {
  it("message → delay → message: one mark_seen in total, remembered in the session context", async () => {
    const { db, session } = fakeDb({ graph: MESSAGE_DELAY_MESSAGE_GRAPH });

    const first = await startFlow(db, FLOW, CONTACT);

    expect(first).toEqual({ status: "delayed", nodeId: "d1" });
    expect(actionsSent()).toEqual(["mark_seen", "typing_on"]);
    expect(session.status).toBe("ACTIVE");
    expect(session.resumeAt).toBeInstanceOf(Date);
    expect((session.context as Record<string, unknown>)._markSeenSent).toBe(true);

    senderAction.mockClear();
    const second = await resumeDelayed(db, session);

    expect(second).toEqual({ status: "completed" });
    expect(actionsSent()).toEqual(["typing_on"]);
  });

  it("delay → message: the worker resumes the parked session and mark_seen goes out with the first reply", async () => {
    const { db, session } = fakeDb({ graph: DELAY_MESSAGE_GRAPH });

    await startFlow(db, FLOW, CONTACT);

    expect(session.currentNodeId).toBe("m1");
    expect(senderAction).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();

    // tickDelayedSessions used to call startFlow here, which refuses to touch
    // an existing ACTIVE session — so the post-delay message never went out.
    const resumed = await tickDelayedSessions(db);

    expect(resumed).toBe(1);
    expect(db.flowSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { resumeAt: null },
    });
    expect(textsSent()).toHaveLength(1);
    expect(textsSent()[0]).toContain("depois");
    expect(actionsSent()).toEqual(["mark_seen", "typing_on"]);
    expect(session.status).toBe("COMPLETED");
  });

  it("question → reply: a fresh inbound message gets its own mark_seen", async () => {
    const { db, session } = fakeDb({ graph: QUESTION_GRAPH });

    await startFlow(db, FLOW, CONTACT);

    expect(session.status).toBe("WAITING_INPUT");
    expect(actionsSent()).toEqual(["mark_seen", "typing_on"]);

    senderAction.mockClear();
    await resumeWithInput(db, session, "Ana");

    expect(actionsSent()).toEqual(["mark_seen", "typing_on"]);
    expect((session.context as Record<string, unknown>).name).toBe("Ana");
  });
});

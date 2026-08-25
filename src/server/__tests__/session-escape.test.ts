import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/**
 * Guards the two ways out of a flow that is waiting on the contact: the
 * escape words, and the 24h sweeper.
 */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendText } from "../instagram";
import { handleInboundMessage } from "../trigger-dispatch";
import { sweepStaleSessions, STALE_SESSION_MS } from "../broadcast-worker";

const CONTACT = "contact-1";
const MENU_FLOW = "flow-menu";

const MENU_GRAPH = {
  nodes: [
    {
      id: "m1",
      type: "message",
      position: { x: 0, y: 0 },
      data: { kind: "message", text: "Menu:" },
    },
    { id: "e1", type: "end", position: { x: 0, y: 0 }, data: { kind: "end" } },
  ],
  edges: [{ id: "m1-e1", source: "m1", target: "e1" }],
};

function fakeDb(opts: { menuTrigger?: boolean } = {}) {
  const waiting = {
    id: "s-wait",
    flowId: "flow-question",
    contactId: CONTACT,
    currentNodeId: "q1",
    status: "WAITING_INPUT",
    context: {},
  } as unknown as FlowSession;
  const session = { id: "s-new", status: "ACTIVE", context: {}, currentNodeId: null };
  const write = ({ data }: { data: object }) => {
    Object.assign(session, data);
    return Promise.resolve({ ...session, flowId: MENU_FLOW, contactId: CONTACT });
  };

  const db = {
    contact: { findUnique: vi.fn().mockResolvedValue({ id: CONTACT, subscribed: true }) },
    flow: {
      findUnique: vi.fn().mockResolvedValue({ id: MENU_FLOW, enabled: true, graph: MENU_GRAPH }),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ id: MENU_FLOW, enabled: true, graph: MENU_GRAPH }),
    },
    flowSession: {
      // The waiting session is only visible until the escape abandons it.
      findFirst: vi.fn(async () => (db.flowSession.updateMany.mock.calls.length ? null : waiting)),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(write),
      update: vi.fn(write),
    },
    trigger: {
      findMany: vi.fn().mockResolvedValue(
        opts.menuTrigger
          ? [
              {
                id: "trg-menu",
                flowId: MENU_FLOW,
                kind: "KEYWORD",
                pattern: "menu",
                match: "EXACT",
                enabled: true,
                priority: 0,
              },
            ]
          : [],
      ),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    unmatchedMessage: { upsert: vi.fn().mockResolvedValue({}) },
    contactField: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };

  return db;
}

beforeEach(() => {
  vi.mocked(sendText).mockClear();
});

describe("escape keywords", () => {
  it("'menu' abandons the waiting session and then fires the owner's menu trigger", async () => {
    const db = fakeDb({ menuTrigger: true });

    await handleInboundMessage(db as unknown as PrismaClient, CONTACT, "menu");

    expect(db.flowSession.updateMany).toHaveBeenCalledWith({
      where: { contactId: CONTACT, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
      data: { status: "ABANDONED", abandonedAt: expect.any(Date) },
    });
    // The old question did not swallow the word...
    expect(db.flow.findUniqueOrThrow).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "flow-question" } }),
    );
    // ...and the menu flow started.
    expect(db.flowSession.create).toHaveBeenCalledTimes(1);
    expect(db.flowSession.create.mock.calls[0]![0]).toMatchObject({
      data: { flowId: MENU_FLOW, contactId: CONTACT },
    });
  });

  it("'recomeçar' with no trigger just frees the contact, and is not an opt-out", async () => {
    const db = fakeDb();

    await handleInboundMessage(db as unknown as PrismaClient, CONTACT, "Recomeçar");

    expect(db.flowSession.updateMany).toHaveBeenCalledTimes(1);
    expect(db.flowSession.create).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    // It falls through to the ordinary path, so it is recorded as a miss.
    expect(db.unmatchedMessage.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("sweepStaleSessions", () => {
  it("abandons WAITING_INPUT sessions untouched for 24h, and nothing else", async () => {
    const now = new Date("2026-08-25T12:00:00Z");
    const db = {
      flowSession: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
    } as unknown as PrismaClient;

    const swept = await sweepStaleSessions(db, now);

    expect(swept).toBe(3);
    expect(db.flowSession.updateMany).toHaveBeenCalledWith({
      where: {
        status: "WAITING_INPUT",
        updatedAt: { lt: new Date(now.getTime() - STALE_SESSION_MS) },
      },
      data: { status: "ABANDONED", abandonedAt: expect.any(Date) },
    });
    expect(STALE_SESSION_MS).toBe(24 * 60 * 60 * 1000);
  });
});

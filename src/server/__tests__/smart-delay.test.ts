import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/**
 * Smart delay: fixed (with an optional cancel-on-reply), until the contact
 * replies (with an optional timeout), and until a wall-clock date.
 */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendMessage } from "../instagram";
import { startFlow, resumeWithInput, resumeDelayed } from "../flow-runner";
import { resumeAtFor } from "../message-payload";
import { tickDelayedSessions, sweepStaleSessions } from "../broadcast-worker";
import { FlowGraph, outputsOf, validateGraph } from "../../lib/flow-schema";

const CONTACT = "contact-1";
const FLOW = "flow-1";

const node = (id: string, data: object) => ({
  id,
  type: (data as { kind: string }).kind,
  position: { x: 0, y: 0 },
  data,
});

/** delay → "depois" ; delay -replied/timeout-> "cedo". */
function graphWith(delay: object, altHandle?: string) {
  return {
    nodes: [
      node("d1", delay),
      node("later", { kind: "message", text: "depois" }),
      node("early", { kind: "message", text: "cedo" }),
      node("e", { kind: "end" }),
    ],
    edges: [
      { id: "d1-later", source: "d1", target: "later" },
      ...(altHandle
        ? [{ id: "d1-early", source: "d1", target: "early", sourceHandle: altHandle }]
        : []),
      { id: "later-e", source: "later", target: "e" },
      { id: "early-e", source: "early", target: "e" },
    ],
  };
}

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
  const write = ({ data }: { data: object }) => {
    Object.assign(session, data);
    return Promise.resolve({ ...session });
  };
  const db = {
    contact: { findUnique: vi.fn().mockResolvedValue({ id: CONTACT, subscribed: true }) },
    flow: {
      findUnique: vi.fn().mockResolvedValue({ id: FLOW, enabled: true, graph }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: FLOW, enabled: true, graph }),
    },
    flowSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn(() => Promise.resolve([{ ...session }])),
      // A due session is claimed by exactly one tick: count 1.
      updateMany: vi.fn(({ data }: { data: object }) => {
        Object.assign(session, data);
        return Promise.resolve({ count: 1 });
      }),
      create: vi.fn(write),
      update: vi.fn(write),
    },
    contactField: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  return { db: db as unknown as PrismaClient, raw: db, session };
}

const texts = () =>
  vi.mocked(sendMessage).mock.calls.map((c) => String((c[2] as { text?: string }).text));

beforeEach(() => vi.mocked(sendMessage).mockClear());

describe("fixed delay", () => {
  it("a legacy delay (no mode) still parks ACTIVE on the next node", async () => {
    const { db, session } = fakeDb(graphWith({ kind: "delay", seconds: 60 }));
    const r = await startFlow(db, FLOW, CONTACT);
    expect(r).toEqual({ status: "delayed", nodeId: "d1" });
    expect(session.status).toBe("ACTIVE");
    expect(session.currentNodeId).toBe("later");
    expect(session.resumeAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it("cancelOnReply parks WAITING_INPUT on the delay; a reply leaves by 'replied'", async () => {
    const g = graphWith({ kind: "delay", seconds: 3600, cancelOnReply: true }, "replied");
    const { db, session } = fakeDb(g);
    await startFlow(db, FLOW, CONTACT);
    expect(session.status).toBe("WAITING_INPUT");
    expect(session.currentNodeId).toBe("d1");
    expect(session.resumeAt).toBeInstanceOf(Date);

    await resumeWithInput(db, session, "oi");
    expect(texts()).toEqual(["cedo"]);
    expect(session.status).toBe("COMPLETED");
  });

  it("cancelOnReply: when the timer fires first, the normal path runs", async () => {
    const g = graphWith({ kind: "delay", seconds: 1, cancelOnReply: true }, "replied");
    const { db, session } = fakeDb(g);
    await startFlow(db, FLOW, CONTACT);
    session.resumeAt = new Date(Date.now() - 1000);
    const n = await tickDelayedSessions(db);
    expect(n).toBe(1);
    expect(texts()).toEqual(["depois"]);
  });

  it("cancelOnReply with the 'replied' handle unwired falls back to the default path", async () => {
    const { db, session } = fakeDb(
      graphWith({ kind: "delay", seconds: 3600, cancelOnReply: true }),
    );
    await startFlow(db, FLOW, CONTACT);
    await resumeWithInput(db, session, "oi");
    expect(texts()).toEqual(["depois"]);
  });
});

describe("untilReply", () => {
  it("waits with no deadline; any message continues", async () => {
    const { db, session } = fakeDb(graphWith({ kind: "delay", mode: "untilReply" }));
    await startFlow(db, FLOW, CONTACT);
    expect(session.status).toBe("WAITING_INPUT");
    expect(session.resumeAt).toBeNull();

    await resumeWithInput(db, session, "qualquer coisa");
    expect(texts()).toEqual(["depois"]);
    expect(session.resumeAt).toBeNull();
  });

  it("with timeoutSeconds the worker leaves by 'timeout'", async () => {
    const g = graphWith({ kind: "delay", mode: "untilReply", timeoutSeconds: 60 }, "timeout");
    const { db, session } = fakeDb(g);
    await startFlow(db, FLOW, CONTACT);
    expect(session.resumeAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);

    session.resumeAt = new Date(Date.now() - 1);
    await resumeDelayed(db, session);
    expect(texts()).toEqual(["cedo"]);
  });

  it("a session waiting on a reply is not swept as stale while its timeout stands", async () => {
    const { db, raw } = fakeDb(
      graphWith({ kind: "delay", mode: "untilReply", timeoutSeconds: 60 }),
    );
    await sweepStaleSessions(db);
    expect(raw.flowSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ resumeAt: null }) }),
    );
  });
});

describe("untilDate", () => {
  it("resumes at the wall-clock date in the account timezone", () => {
    const d = { kind: "delay" as const, mode: "untilDate" as const, untilDate: "2099-01-01T09:00" };
    const at = resumeAtFor(d, new Date("2026-01-01T00:00:00Z"), "America/Sao_Paulo");
    expect(at.toISOString()).toBe("2099-01-01T12:00:00.000Z"); // 09:00 -03:00
  });

  it("a date in the past continues immediately", async () => {
    const g = graphWith({ kind: "delay", mode: "untilDate", untilDate: "2020-01-01T09:00" });
    const { db, session } = fakeDb(g);
    const r = await startFlow(db, FLOW, CONTACT);
    expect(r).toEqual({ status: "completed" });
    expect(texts()).toEqual(["depois"]);
    expect(session.resumeAt).toBeNull();
  });

  it("a future date parks ACTIVE on the next node with resumeAt set", async () => {
    const g = graphWith({ kind: "delay", mode: "untilDate", untilDate: "2099-01-01T09:00" });
    const { db, session } = fakeDb(g);
    const r = await startFlow(db, FLOW, CONTACT);
    expect(r).toEqual({ status: "delayed", nodeId: "d1" });
    expect(session.currentNodeId).toBe("later");
    expect(session.resumeAt!.getUTCFullYear()).toBe(2099);
  });
});

describe("delay schema and handles", () => {
  it("fixed requires seconds; untilDate requires a date; untilReply needs neither", () => {
    const parse = (data: object) =>
      FlowGraph.safeParse({ nodes: [node("d", data)], edges: [] }).success;
    expect(parse({ kind: "delay" })).toBe(false);
    expect(parse({ kind: "delay", mode: "untilDate" })).toBe(false);
    expect(parse({ kind: "delay", mode: "untilDate", untilDate: "2026-08-25T09:00" })).toBe(true);
    expect(parse({ kind: "delay", mode: "untilReply" })).toBe(true);
  });

  it("exposes the extra handle only when it applies", () => {
    const handles = (data: object) =>
      outputsOf(FlowGraph.parse({ nodes: [node("d", data)], edges: [] }).nodes[0]!).map(
        (o) => o.handle,
      );
    expect(handles({ kind: "delay", seconds: 5 })).toEqual([""]);
    expect(handles({ kind: "delay", seconds: 5, cancelOnReply: true })).toEqual([
      "next",
      "replied",
    ]);
    expect(handles({ kind: "delay", mode: "untilReply", timeoutSeconds: 5 })).toEqual([
      "next",
      "timeout",
    ]);
  });

  it("warns when the extra handle is unwired", () => {
    const g = FlowGraph.parse(graphWith({ kind: "delay", mode: "untilReply", timeoutSeconds: 5 }));
    expect(validateGraph(g).some((i) => i.message.includes("tempo esgotado"))).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/** Go To Step jumps inside a flow; Go To Flow hands the contact to another flow. */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendMessage } from "../instagram";
import { startFlow } from "../flow-runner";
import { FlowGraph, validateGraph } from "../../lib/flow-schema";
import { previewFrom } from "../../lib/flow-preview";

const CONTACT = "contact-1";

const node = (id: string, data: object) => ({
  id,
  type: (data as { kind: string }).kind,
  position: { x: 0, y: 0 },
  data,
});

/** m1 → goto(step m2) ; m2 → end. */
const STEP_GRAPH = {
  nodes: [
    node("m1", { kind: "message", text: "um" }),
    node("g", { kind: "goto", target: { nodeId: "m2" } }),
    node("m2", { kind: "message", text: "dois" }),
    node("e", { kind: "end" }),
  ],
  edges: [
    { id: "a", source: "m1", target: "g" },
    { id: "b", source: "m2", target: "e" },
  ],
};

/** m1 → goto(flow B). */
const FLOW_A = {
  nodes: [
    node("m1", { kind: "message", text: "A" }),
    node("g", { kind: "goto", target: { flowId: "flow-b" } }),
  ],
  edges: [{ id: "a", source: "m1", target: "g" }],
};
const FLOW_B = {
  nodes: [node("m1", { kind: "message", text: "B" }), node("e", { kind: "end" })],
  edges: [{ id: "a", source: "m1", target: "e" }],
};
/** Two flows bouncing to each other. */
const PING = {
  nodes: [node("g", { kind: "goto", target: { flowId: "pong" } })],
  edges: [],
};
const PONG = {
  nodes: [node("g", { kind: "goto", target: { flowId: "ping" } })],
  edges: [],
};

/** A db with several flows; every session write lands in `sessions` by id. */
function fakeDb(flows: Record<string, object>, opts: { existingInTarget?: boolean } = {}) {
  const sessions: Record<string, FlowSession> = {};
  let n = 0;
  const db = {
    contact: { findUnique: vi.fn().mockResolvedValue({ id: CONTACT, subscribed: true }) },
    flow: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          flows[where.id] ? { id: where.id, enabled: true, graph: flows[where.id] } : null,
        ),
      ),
      findUniqueOrThrow: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, enabled: true, graph: flows[where.id] }),
      ),
    },
    flowSession: {
      findFirst: vi.fn(({ where }: { where: { flowId: string } }) =>
        Promise.resolve(
          opts.existingInTarget && where.flowId === "flow-b"
            ? { id: "old", currentNodeId: "m1", status: "WAITING_INPUT" }
            : null,
        ),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(({ data }: { data: object }) => {
        const s = { id: `s${++n}`, context: {}, resumeAt: null, ...data } as unknown as FlowSession;
        sessions[s.id] = s;
        return Promise.resolve({ ...s });
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: object }) => {
        Object.assign(sessions[where.id]!, data);
        return Promise.resolve({ ...sessions[where.id]! });
      }),
    },
    contactField: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  return { db: db as unknown as PrismaClient, raw: db, sessions };
}

const texts = () =>
  vi.mocked(sendMessage).mock.calls.map((c) => String((c[2] as { text?: string }).text));

beforeEach(() => vi.mocked(sendMessage).mockClear());

describe("goto step", () => {
  it("jumps to the named node in the same session", async () => {
    const { db, sessions } = fakeDb({ f: STEP_GRAPH });
    const r = await startFlow(db, "f", CONTACT);
    expect(r).toEqual({ status: "completed" });
    expect(texts()).toEqual(["um", "dois"]);
    expect(Object.keys(sessions)).toEqual(["s1"]);
  });

  it("a goto loop is bounded by the step cap", async () => {
    const loop = {
      nodes: [
        node("m1", { kind: "message", text: "x" }),
        node("g", { kind: "goto", target: { nodeId: "m1" } }),
      ],
      edges: [{ id: "a", source: "m1", target: "g" }],
    };
    const { db } = fakeDb({ f: loop });
    await startFlow(db, "f", CONTACT);
    expect(texts().length).toBeLessThanOrEqual(50);
    expect(texts().length).toBeGreaterThan(1);
  });
});

describe("goto flow", () => {
  it("completes the current session and starts the target flow", async () => {
    const { db, sessions } = fakeDb({ "flow-a": FLOW_A, "flow-b": FLOW_B });
    const r = await startFlow(db, "flow-a", CONTACT);
    expect(r).toEqual({ status: "completed" });
    expect(texts()).toEqual(["A", "B"]);
    expect(sessions.s1!.status).toBe("COMPLETED");
    expect(sessions.s1!.flowId).toBe("flow-a");
    expect(sessions.s2!.flowId).toBe("flow-b");
    expect(sessions.s2!.status).toBe("COMPLETED");
  });

  it("takes over a session already running in the target flow instead of being blocked", async () => {
    const { db, raw } = fakeDb({ "flow-a": FLOW_A, "flow-b": FLOW_B }, { existingInTarget: true });
    await startFlow(db, "flow-a", CONTACT);
    expect(raw.flowSession.updateMany).toHaveBeenCalledWith({
      where: { contactId: CONTACT, flowId: "flow-b", status: { in: ["ACTIVE", "WAITING_INPUT"] } },
      data: { status: "ABANDONED", abandonedAt: expect.any(Date) },
    });
    expect(texts()).toEqual(["A", "B"]);
  });

  it("a plain startFlow still refuses to double-start", async () => {
    const { db, raw } = fakeDb({ "flow-b": FLOW_B }, { existingInTarget: true });
    const r = await startFlow(db, "flow-b", CONTACT);
    expect(r).toEqual({ status: "waiting", nodeId: "m1" });
    expect(raw.flowSession.create).not.toHaveBeenCalled();
  });

  it("two flows pointing at each other stop at the hop limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, raw } = fakeDb({ ping: PING, pong: PONG });
    const r = await startFlow(db, "ping", CONTACT);
    expect(r).toEqual({ status: "completed" });
    expect(raw.flowSession.create).toHaveBeenCalledTimes(6); // 1 + MAX_HOPS
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a disabled or missing target flow ends quietly", async () => {
    const { db } = fakeDb({ "flow-a": FLOW_A });
    const r = await startFlow(db, "flow-a", CONTACT);
    expect(r).toEqual({ status: "completed" });
    expect(texts()).toEqual(["A"]);
  });
});

describe("goto in validateGraph and preview", () => {
  it("flags a step target that does not exist", () => {
    const g = FlowGraph.parse({
      nodes: [node("g", { kind: "goto", target: { nodeId: "ghost" } })],
      edges: [],
    });
    expect(validateGraph(g).some((i) => i.level === "error" && i.message.includes("ghost"))).toBe(
      true,
    );
  });

  it("does not warn that a goto leads nowhere", () => {
    const g = FlowGraph.parse(FLOW_A);
    expect(validateGraph(g).filter((i) => i.message.includes("lugar nenhum"))).toHaveLength(0);
  });

  it("preview follows a step goto and notes a flow goto", () => {
    const step = previewFrom(FlowGraph.parse(STEP_GRAPH));
    expect(step.map((i) => i.kind)).toEqual(["bubble", "note", "bubble", "end"]);
    const flow = previewFrom(FlowGraph.parse(FLOW_A));
    expect(flow.at(-1)).toMatchObject({ kind: "note", text: expect.stringContaining("flow-b") });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/** A goal node records a FlowGoalHit as the contact passes, then continues. */

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
const FLOW = "flow-1";
const node = (id: string, data: object) => ({
  id,
  type: (data as { kind: string }).kind,
  position: { x: 0, y: 0 },
  data,
});
const GRAPH = {
  nodes: [
    node("g", { kind: "goal", name: "Compra" }),
    node("m", { kind: "message", text: "valeu" }),
    node("e", { kind: "end" }),
  ],
  edges: [
    { id: "a", source: "g", target: "m" },
    { id: "b", source: "m", target: "e" },
  ],
};

function fakeDb(opts: { goalFails?: boolean } = {}) {
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
    flow: { findUnique: vi.fn().mockResolvedValue({ id: FLOW, enabled: true, graph: GRAPH }) },
    flowSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(write),
      update: vi.fn(write),
    },
    flowGoalHit: {
      create: opts.goalFails
        ? vi.fn().mockRejectedValue(new Error("db down"))
        : vi.fn().mockResolvedValue({}),
    },
    contactField: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db: db as unknown as PrismaClient, raw: db, session };
}

beforeEach(() => vi.mocked(sendMessage).mockClear());

describe("goal node", () => {
  it("records a hit with session, flow, node and contact, then continues", async () => {
    const { db, raw, session } = fakeDb();
    const r = await startFlow(db, FLOW, CONTACT);
    expect(r).toEqual({ status: "completed" });
    expect(raw.flowGoalHit.create).toHaveBeenCalledWith({
      data: { sessionId: "s1", flowId: FLOW, nodeId: "g", contactId: CONTACT },
    });
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
    expect(session.status).toBe("COMPLETED");
  });

  it("a failed write does not stop the flow", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = fakeDb({ goalFails: true });
    await startFlow(db, FLOW, CONTACT);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("needs a name, validates as a pass-through, and previews as a note", () => {
    expect(
      FlowGraph.safeParse({ nodes: [node("g", { kind: "goal", name: " " })], edges: [] }).success,
    ).toBe(false);
    const g = FlowGraph.parse(GRAPH);
    expect(validateGraph(g).filter((i) => i.level === "error")).toHaveLength(0);
    expect(previewFrom(g)[0]).toMatchObject({ kind: "note", text: 'Meta "Compra" atingida' });
  });
});

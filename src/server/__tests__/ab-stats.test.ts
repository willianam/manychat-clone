import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/** A randomizer records which arm it chose; abStats turns that into rates. */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendMessage } from "../instagram";
import { startFlow } from "../flow-runner";
import { abStats } from "../ab-stats";
import { FlowGraph, outputsOf } from "../../lib/flow-schema";
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
    node("r", { kind: "random", weights: [50, 50], labels: ["Curta", "Longa"] }),
    node("a", { kind: "message", text: "A" }),
    node("b", { kind: "message", text: "B" }),
    node("e", { kind: "end" }),
  ],
  edges: [
    { id: "r-a", source: "r", target: "a", sourceHandle: "0" },
    { id: "r-b", source: "r", target: "b", sourceHandle: "1" },
    { id: "a-e", source: "a", target: "e" },
    { id: "b-e", source: "b", target: "e" },
  ],
};

function fakeDb(rows: { assignments?: object[]; hits?: object[] } = {}) {
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
    abAssignment: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue(rows.assignments ?? []),
    },
    flowGoalHit: { findMany: vi.fn().mockResolvedValue(rows.hits ?? []) },
    contactField: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db: db as unknown as PrismaClient, raw: db, session };
}

beforeEach(() => vi.mocked(sendMessage).mockClear());

describe("random node records its arm", () => {
  it("writes context._ab and an AbAssignment row for the chosen handle", async () => {
    const { db, raw, session } = fakeDb();
    await startFlow(db, FLOW, CONTACT);
    const ab = (session.context as { _ab: Record<string, string> })._ab;
    expect(["0", "1"]).toContain(ab.r);
    expect(raw.abAssignment.create).toHaveBeenCalledWith({
      data: { sessionId: "s1", flowId: FLOW, nodeId: "r", handle: ab.r },
    });
    const sent = String((vi.mocked(sendMessage).mock.calls[0]![2] as { text: string }).text);
    expect(sent).toBe(ab.r === "0" ? "A" : "B");
  });

  it("a failed assignment write does not stop the flow", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, raw } = fakeDb();
    (raw.abAssignment.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("down"));
    await startFlow(db, FLOW, CONTACT);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("abStats", () => {
  it("counts sessions and converted sessions per arm", async () => {
    const { db } = fakeDb({
      assignments: [
        { sessionId: "s1", handle: "0" },
        { sessionId: "s2", handle: "0" },
        { sessionId: "s3", handle: "1" },
        { sessionId: "s4", handle: "1" },
        { sessionId: "s5", handle: "1" },
      ],
      // s1 hit two goals: still one converted session.
      hits: [{ sessionId: "s1" }, { sessionId: "s1" }, { sessionId: "s3" }, { sessionId: "s5" }],
    });
    expect(await abStats(db, FLOW, "r")).toEqual([
      { handle: "0", label: "Curta", weight: 50, sessions: 2, goals: 1, rate: 50 },
      { handle: "1", label: "Longa", weight: 50, sessions: 3, goals: 2, rate: 66.7 },
    ]);
  });

  it("returns null rates with no data, and nothing for a non-random node", async () => {
    const { db } = fakeDb();
    expect((await abStats(db, FLOW, "r")).map((a) => a.rate)).toEqual([null, null]);
    expect(await abStats(db, FLOW, "a")).toEqual([]);
  });
});

describe("labels", () => {
  it("show on outputs and in the preview; fall back to Saída N", () => {
    const g = FlowGraph.parse(GRAPH);
    expect(outputsOf(g.nodes[0]!).map((o) => o.label)).toEqual(["Curta · 50%", "Longa · 50%"]);
    const fork = previewFrom(g)[0] as { choices: Array<{ label: string }> };
    expect(fork.choices[1]!.label).toBe("Longa · 50%");

    const plain = FlowGraph.parse({
      ...GRAPH,
      nodes: [node("r", { kind: "random", weights: [50, 50] }), ...GRAPH.nodes.slice(1)],
    });
    expect(outputsOf(plain.nodes[0]!).map((o) => o.label)).toEqual(["50%", "50%"]);
    expect((previewFrom(plain)[0] as { choices: Array<{ label: string }> }).choices[0]!.label).toBe(
      "Saída 1 · 50%",
    );
  });
});

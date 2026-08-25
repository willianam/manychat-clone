import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/** Conditions: several rules under and/or, plus the newer operators. */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendMessage } from "../instagram";
import { startFlow } from "../flow-runner";
import { FlowGraph } from "../../lib/flow-schema";
import { previewFrom } from "../../lib/flow-preview";

const CONTACT = "contact-1";
const FLOW = "flow-1";
const node = (id: string, data: object) => ({
  id,
  type: (data as { kind: string }).kind,
  position: { x: 0, y: 0 },
  data,
});
const graphWith = (cond: object) => ({
  nodes: [
    node("c", { kind: "condition", key: "x", op: "exists", ...cond }),
    node("yes", { kind: "message", text: "sim" }),
    node("no", { kind: "message", text: "não" }),
    node("e", { kind: "end" }),
  ],
  edges: [
    { id: "c-yes", source: "c", target: "yes", sourceHandle: "true" },
    { id: "c-no", source: "c", target: "no", sourceHandle: "false" },
    { id: "yes-e", source: "yes", target: "e" },
    { id: "no-e", source: "no", target: "e" },
  ],
});

function fakeDb(
  graph: object,
  opts: { fields?: Record<string, string>; tags?: string[]; subscribed?: boolean } = {},
) {
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
  const state = { subscribed: opts.subscribed ?? true };
  const db = {
    contact: {
      findUnique: vi.fn(() => Promise.resolve({ id: CONTACT, subscribed: state.subscribed })),
      update: vi.fn(({ data }: { data: { subscribed: boolean } }) => {
        state.subscribed = data.subscribed;
        return Promise.resolve({});
      }),
    },
    flow: { findUnique: vi.fn().mockResolvedValue({ id: FLOW, enabled: true, graph }) },
    flowSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(write),
      update: vi.fn(write),
    },
    contactField: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          Object.entries(opts.fields ?? {}).map(([key, value]) => ({ key, value })),
        ),
    },
    contactTag: {
      findFirst: vi.fn(({ where }: { where: { tag: { name: string } } }) =>
        Promise.resolve((opts.tags ?? []).includes(where.tag.name) ? { tagId: "t" } : null),
      ),
    },
  };
  return db as unknown as PrismaClient;
}

const answer = () => String((vi.mocked(sendMessage).mock.calls[0]![2] as { text: string }).text);
beforeEach(() => vi.mocked(sendMessage).mockClear());

const run = async (cond: object, opts?: Parameters<typeof fakeDb>[1]) => {
  vi.mocked(sendMessage).mockClear();
  await startFlow(fakeDb(graphWith(cond), opts), FLOW, CONTACT);
  return answer();
};

describe("compound conditions", () => {
  it("a legacy single rule still works", async () => {
    expect(await run({ key: "nome", op: "exists" }, { fields: { nome: "Ana" } })).toBe("sim");
    expect(await run({ key: "nome", op: "exists" })).toBe("não");
  });

  it("and requires every rule; or needs one", async () => {
    const rules = [
      { key: "nome", op: "exists" },
      { key: "vip", op: "hasTag" },
    ];
    const fields = { nome: "Ana" };
    expect(await run({ rules, combinator: "and" }, { fields })).toBe("não");
    expect(await run({ rules, combinator: "and" }, { fields, tags: ["vip"] })).toBe("sim");
    expect(await run({ rules, combinator: "or" }, { fields })).toBe("sim");
    expect(await run({ rules, combinator: "or" }, {})).toBe("não");
  });

  it("rules replace the single rule when present", async () => {
    // Single rule says "x exists" (false); rules say "nome exists" (true).
    expect(await run({ rules: [{ key: "nome", op: "exists" }] }, { fields: { nome: "Ana" } })).toBe(
      "sim",
    );
  });
});

describe("new operators", () => {
  const rule = (r: object) => ({ rules: [r] });

  it("notHasTag", async () => {
    expect(await run(rule({ key: "vip", op: "notHasTag" }), { tags: ["vip"] })).toBe("não");
    expect(await run(rule({ key: "vip", op: "notHasTag" }))).toBe("sim");
  });

  it("subscribed reads the live flag: an unsubscribe earlier in the flow flips it", async () => {
    expect(await run(rule({ key: "", op: "subscribed" }))).toBe("sim");

    // An opted-out contact never starts a flow, so the false case is a
    // contact who opts out mid-flow: action(unsubscribe) → condition.
    const g = graphWith(rule({ key: "", op: "subscribed" }));
    g.nodes.unshift(node("a", { kind: "action", ops: [{ op: "unsubscribe" }] }));
    g.edges.push({ id: "a-c", source: "a", target: "c" });
    vi.mocked(sendMessage).mockClear();
    await startFlow(fakeDb(g), FLOW, CONTACT);
    expect(answer()).toBe("não");
  });

  it("between on numbers and dates, inclusive", async () => {
    const r = { key: "total", op: "between", value: "100, 200" };
    expect(await run(rule(r), { fields: { total: "150" } })).toBe("sim");
    expect(await run(rule(r), { fields: { total: "200" } })).toBe("sim");
    expect(await run(rule(r), { fields: { total: "1.500,00" } })).toBe("não");
    const d = { key: "dia", op: "between", value: "01/08/2026,31/08/2026" };
    expect(await run(rule(d), { fields: { dia: "2026-08-15" } })).toBe("sim");
    expect(await run(rule(d), { fields: { dia: "2026-09-01" } })).toBe("não");
    expect(await run(rule({ key: "x", op: "between", value: "1" }), { fields: { x: "1" } })).toBe(
      "não",
    );
  });

  it("startsWith and isEmpty", async () => {
    expect(
      await run(rule({ key: "cep", op: "startsWith", value: "01" }), { fields: { cep: "01310" } }),
    ).toBe("sim");
    expect(
      await run(rule({ key: "cep", op: "startsWith", value: "02" }), { fields: { cep: "01310" } }),
    ).toBe("não");
    expect(await run(rule({ key: "cep", op: "isEmpty" }), { fields: { cep: "  " } })).toBe("sim");
    expect(await run(rule({ key: "cep", op: "isEmpty" }), { fields: { cep: "x" } })).toBe("não");
  });

  it("inLastDays counts back from now", async () => {
    const iso = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const r = { key: "compra", op: "inLastDays", value: "7" };
    expect(await run(rule(r), { fields: { compra: iso(3) } })).toBe("sim");
    expect(await run(rule(r), { fields: { compra: iso(10) } })).toBe("não");
    expect(await run(rule(r), { fields: { compra: "ontem" } })).toBe("não");
  });
});

describe("preview label", () => {
  it("joins the rules with e / ou", () => {
    const g = FlowGraph.parse(
      graphWith({
        rules: [
          { key: "nome", op: "exists" },
          { key: "vip", op: "hasTag" },
        ],
        combinator: "or",
      }),
    );
    expect(previewFrom(g)[0]).toMatchObject({
      kind: "fork",
      label: "Se nome exists ou vip hasTag",
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/** The request node in the runner: templates, mapping, and the two exits. */

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

const CONTACT = "contact-1";
const FLOW = "flow-1";
const node = (id: string, data: object) => ({
  id,
  type: (data as { kind: string }).kind,
  position: { x: 0, y: 0 },
  data,
});
const graphWith = (req: object) => ({
  nodes: [
    node("r", req),
    node("ok", { kind: "message", text: "preço {{preco}}" }),
    node("bad", { kind: "message", text: "falhou" }),
    node("e", { kind: "end" }),
  ],
  edges: [
    { id: "r-ok", source: "r", target: "ok", sourceHandle: "success" },
    { id: "r-bad", source: "r", target: "bad", sourceHandle: "error" },
    { id: "ok-e", source: "ok", target: "e" },
    { id: "bad-e", source: "bad", target: "e" },
  ],
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
  const write = ({ data }: { data: object }) => {
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
      findMany: vi.fn().mockResolvedValue([
        { key: "nome", value: "Ana Maria" },
        { key: "q", value: 'a"b' },
      ]),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  return { db: db as unknown as PrismaClient, raw: db, session };
}

const texts = () =>
  vi.mocked(sendMessage).mock.calls.map((c) => String((c[2] as { text?: string }).text));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(sendMessage).mockClear();
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ data: { price: 99.9 } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("request node", () => {
  it("interpolates the URL (encoded), maps the reply into a field and leaves by success", async () => {
    const g = graphWith({
      kind: "request",
      method: "GET",
      url: "https://api.exemplo.com/q?nome={{nome}}",
      mapping: [{ path: "data.price", field: "preco" }],
    });
    const { db, raw, session } = fakeDb(g);
    await startFlow(db, FLOW, CONTACT);

    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.exemplo.com/q?nome=Ana%20Maria");
    expect(raw.contactField.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { contactId: CONTACT, key: "preco", value: "99.9" } }),
    );
    expect(texts()).toEqual(["preço 99.9"]);
    expect(session.status).toBe("COMPLETED");
  });

  it("escapes values inside a JSON body", async () => {
    const g = graphWith({
      kind: "request",
      method: "POST",
      url: "https://api.exemplo.com/x",
      body: '{"q":"{{q}}"}',
    });
    const { db } = fakeDb(g);
    await startFlow(db, FLOW, CONTACT);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('{"q":"a\\"b"}');
    expect(JSON.parse(init.body as string)).toEqual({ q: 'a"b' });
  });

  it("a failed call leaves by error and maps nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    const g = graphWith({
      kind: "request",
      method: "GET",
      url: "https://api.exemplo.com/x",
      mapping: [{ path: "data.price", field: "preco" }],
    });
    const { db, raw } = fakeDb(g);
    await startFlow(db, FLOW, CONTACT);
    expect(texts()).toEqual(["falhou"]);
    expect(raw.contactField.upsert).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a private URL never reaches fetch and leaves by error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = graphWith({ kind: "request", method: "GET", url: "http://10.0.0.5/admin" });
    const { db } = fakeDb(g);
    await startFlow(db, FLOW, CONTACT);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(texts()).toEqual(["falhou"]);
    warn.mockRestore();
  });

  it("validateGraph requires success wired and warns on error unwired", () => {
    const g = FlowGraph.parse({
      nodes: [
        node("r", { kind: "request", method: "GET", url: "https://a.b/c" }),
        node("e", { kind: "end" }),
      ],
      edges: [{ id: "x", source: "r", target: "e", sourceHandle: "error" }],
    });
    const issues = validateGraph(g);
    expect(issues.some((i) => i.level === "error" && i.message.includes("sucesso"))).toBe(true);
    const g2 = FlowGraph.parse({
      nodes: [
        node("r", { kind: "request", method: "GET", url: "https://a.b/c" }),
        node("e", { kind: "end" }),
      ],
      edges: [{ id: "x", source: "r", target: "e", sourceHandle: "success" }],
    });
    expect(validateGraph(g2).some((i) => i.level === "warning" && i.message.includes("erro"))).toBe(
      true,
    );
  });
});

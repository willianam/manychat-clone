import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/**
 * User Input: a question validates what comes back, re-asks with the
 * validation message, gives up after maxAttempts, and lets a person skip.
 */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendMessage } from "../instagram";
import { startFlow, resumeWithInput, resumeWithPostback } from "../flow-runner";
import { FlowGraph, validateGraph } from "../../lib/flow-schema";

const CONTACT = "contact-1";
const FLOW = "flow-1";

const node = (id: string, data: object) => ({
  id,
  type: (data as { kind: string }).kind,
  position: { x: 0, y: 0 },
  data,
});

function graphWith(question: object, extraEdges: object[] = []) {
  return {
    nodes: [
      node("q1", question),
      node("ok", { kind: "message", text: "obrigado {{email}}" }),
      node("bad", { kind: "message", text: "sem email" }),
      node("e1", { kind: "end" }),
    ],
    edges: [
      { id: "q1-ok", source: "q1", target: "ok" },
      { id: "ok-e1", source: "ok", target: "e1" },
      { id: "bad-e1", source: "bad", target: "e1" },
      ...extraEdges,
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

const payloads = () => vi.mocked(sendMessage).mock.calls.map((c) => c[2]);
const texts = () => payloads().map((p) => String((p as { text?: string }).text ?? ""));

beforeEach(() => vi.mocked(sendMessage).mockClear());

describe("question with inputType", () => {
  it("stores a valid email and continues", async () => {
    const q = { kind: "question", text: "email?", saveAs: "email", inputType: "email" };
    const { db, session, raw } = fakeDb(graphWith(q));
    await startFlow(db, FLOW, CONTACT);
    await resumeWithInput(db, session, "Ana@Exemplo.com");

    expect((session.context as Record<string, unknown>).email).toBe("ana@exemplo.com");
    expect(raw.contactField.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ value: "ana@exemplo.com" }) }),
    );
    expect(texts()).toEqual(["email?", "obrigado ana@exemplo.com"]);
    expect(session.status).toBe("COMPLETED");
  });

  it("re-asks with the validation message and counts the attempt", async () => {
    const q = {
      kind: "question",
      text: "email?",
      saveAs: "email",
      inputType: "email",
      validationMessage: "Esse não vale.",
    };
    const { db, session } = fakeDb(graphWith(q));
    await startFlow(db, FLOW, CONTACT);
    const r = await resumeWithInput(db, session, "nada");

    expect(r).toEqual({ status: "waiting", nodeId: "q1" });
    expect(session.status).toBe("WAITING_INPUT");
    expect(texts()).toEqual(["email?", "Esse não vale."]);
    expect((session.context as { _attempts: Record<string, number> })._attempts.q1).toBe(1);
  });

  it("after maxAttempts leaves by the invalid handle", async () => {
    const q = {
      kind: "question",
      text: "email?",
      saveAs: "email",
      inputType: "email",
      maxAttempts: 2,
    };
    const g = graphWith(q, [
      { id: "q1-bad", source: "q1", target: "bad", sourceHandle: "invalid" },
    ]);
    const { db, session } = fakeDb(g);
    await startFlow(db, FLOW, CONTACT);
    await resumeWithInput(db, session, "x");
    expect(session.status).toBe("WAITING_INPUT");
    await resumeWithInput(db, session, "y");

    expect(texts().at(-1)).toBe("sem email");
    expect(session.status).toBe("COMPLETED");
    expect((session.context as Record<string, unknown>).email).toBeUndefined();
  });

  it("after maxAttempts with no invalid edge follows the default path", async () => {
    const q = {
      kind: "question",
      text: "email?",
      saveAs: "email",
      inputType: "email",
      maxAttempts: 1,
    };
    const { db, session } = fakeDb(graphWith(q));
    await startFlow(db, FLOW, CONTACT);
    await resumeWithInput(db, session, "x");
    expect(texts().at(-1)).toBe("obrigado ");
  });

  it("onInvalid=branch leaves on the first failure", async () => {
    const q = {
      kind: "question",
      text: "n?",
      saveAs: "email",
      inputType: "number",
      onInvalid: "branch",
    };
    const g = graphWith(q, [
      { id: "q1-bad", source: "q1", target: "bad", sourceHandle: "invalid" },
    ]);
    const { db, session } = fakeDb(g);
    await startFlow(db, FLOW, CONTACT);
    await resumeWithInput(db, session, "abc");
    expect(texts()).toEqual(["n?", "sem email"]);
  });

  it("allowSkip sends a Pular quick reply and a tap on it walks on without storing", async () => {
    const q = {
      kind: "question",
      text: "email?",
      saveAs: "email",
      inputType: "email",
      allowSkip: true,
    };
    const { db, session, raw } = fakeDb(graphWith(q));
    await startFlow(db, FLOW, CONTACT);

    const first = payloads()[0] as { quick_replies: Array<{ title: string; payload: string }> };
    expect(first.quick_replies).toEqual([
      { content_type: "text", title: "Pular", payload: "q1:skip" },
    ]);

    await resumeWithPostback(db, session, "q1:skip");
    expect(raw.contactField.upsert).not.toHaveBeenCalled();
    expect(texts().at(-1)).toBe("obrigado ");
    expect(session.status).toBe("COMPLETED");
  });

  it("a skip tap on a question that does not allow it is ignored", async () => {
    const q = { kind: "question", text: "email?", saveAs: "email" };
    const { db, session } = fakeDb(graphWith(q));
    await startFlow(db, FLOW, CONTACT);
    expect(await resumeWithPostback(db, session, "q1:skip")).toBeNull();
    expect(session.status).toBe("WAITING_INPUT");
  });

  it("option chips are offered and a tapped one is the answer", async () => {
    const q = {
      kind: "question",
      text: "tamanho?",
      saveAs: "email",
      inputType: "option",
      options: ["P", "M"],
    };
    const { db, session } = fakeDb(graphWith(q));
    await startFlow(db, FLOW, CONTACT);
    const first = payloads()[0] as { quick_replies: Array<{ title: string }> };
    expect(first.quick_replies.map((c) => c.title)).toEqual(["P", "M"]);

    await resumeWithPostback(db, session, "q1:opt:M");
    expect((session.context as Record<string, unknown>).email).toBe("M");
  });

  it("a legacy question (no inputType) still stores free text", async () => {
    const q = { kind: "question", text: "nome?", saveAs: "email" };
    const { db, session } = fakeDb(graphWith(q));
    await startFlow(db, FLOW, CONTACT);
    await resumeWithInput(db, session, "Ana");
    expect((session.context as Record<string, unknown>).email).toBe("Ana");
    expect(payloads()[0]).toEqual({ text: "nome?" });
  });
});

describe("validateGraph for questions", () => {
  it("requires the invalid edge when onInvalid is branch", () => {
    const g = FlowGraph.parse(
      graphWith({ kind: "question", text: "?", saveAs: "x", onInvalid: "branch" }),
    );
    expect(validateGraph(g).some((i) => i.message.includes("inválida"))).toBe(true);
  });

  it("requires options for an option question", () => {
    const g = FlowGraph.parse(
      graphWith({ kind: "question", text: "?", saveAs: "x", inputType: "option" }),
    );
    expect(validateGraph(g).some((i) => i.message.includes("opção"))).toBe(true);
  });
});

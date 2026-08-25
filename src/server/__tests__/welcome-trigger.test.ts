import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * WELCOME: a first-ever message that matches no keyword starts the welcome
 * flow, ahead of DEFAULT. A known contact never sees it.
 */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));

import { sendMessage } from "../instagram";
import { handleInboundMessage } from "../trigger-dispatch";
import { normalizeDraft, findConflict, describeTrigger, KIND_LABEL } from "../../lib/trigger-rules";

const CONTACT = "contact-1";
const node = (id: string, text: string) => ({
  id,
  type: "message",
  position: { x: 0, y: 0 },
  data: { kind: "message", text },
});
const flows: Record<string, object> = {
  welcome: { nodes: [node("m", "bem-vindo")], edges: [] },
  fallback: { nodes: [node("m", "não entendi")], edges: [] },
  kw: { nodes: [node("m", "o preço é 10")], edges: [] },
};

function fakeDb(opts: { welcome?: boolean; fallback?: boolean } = {}) {
  const db = {
    contact: { findUnique: vi.fn().mockResolvedValue({ id: CONTACT, subscribed: true }) },
    flow: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, enabled: true, graph: flows[where.id] }),
      ),
    },
    flowSession: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(({ data }: { data: object }) =>
        Promise.resolve({ id: "s", context: {}, ...data }),
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    trigger: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "t-kw",
          flowId: "kw",
          kind: "KEYWORD",
          pattern: "preço",
          match: "CONTAINS",
          enabled: true,
          priority: 0,
        },
      ]),
      findFirst: vi.fn(({ where }: { where: { kind: string } }) =>
        Promise.resolve(
          where.kind === "WELCOME" && opts.welcome
            ? { id: "t-w", flowId: "welcome", kind: "WELCOME" }
            : where.kind === "DEFAULT" && opts.fallback
              ? { id: "t-d", flowId: "fallback", kind: "DEFAULT" }
              : null,
        ),
      ),
    },
    unmatchedMessage: { upsert: vi.fn().mockResolvedValue({}) },
    contactField: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

const texts = () =>
  vi.mocked(sendMessage).mock.calls.map((c) => String((c[2] as { text?: string }).text));
beforeEach(() => vi.mocked(sendMessage).mockClear());

describe("WELCOME trigger", () => {
  it("a new contact with no keyword match gets the welcome flow, not the fallback", async () => {
    const { db, raw } = fakeDb({ welcome: true, fallback: true });
    await handleInboundMessage(db, CONTACT, "oi", { isNewContact: true });
    expect(texts()).toEqual(["bem-vindo"]);
    expect(raw.unmatchedMessage.upsert).toHaveBeenCalled(); // the miss is still recorded
  });

  it("a known contact with no match gets the fallback", async () => {
    const { db } = fakeDb({ welcome: true, fallback: true });
    await handleInboundMessage(db, CONTACT, "oi");
    expect(texts()).toEqual(["não entendi"]);
  });

  it("a keyword match beats the welcome even on a first message", async () => {
    const { db } = fakeDb({ welcome: true, fallback: true });
    await handleInboundMessage(db, CONTACT, "qual o preço?", { isNewContact: true });
    expect(texts()).toEqual(["o preço é 10"]);
  });

  it("with no WELCOME trigger a new contact falls through to DEFAULT", async () => {
    const { db } = fakeDb({ fallback: true });
    await handleInboundMessage(db, CONTACT, "oi", { isNewContact: true });
    expect(texts()).toEqual(["não entendi"]);
  });
});

describe("WELCOME in trigger rules", () => {
  it("is patternless and collides on kind alone", () => {
    const r = normalizeDraft({ kind: "WELCOME", pattern: "ignorado" });
    expect(r).toEqual({
      ok: true,
      draft: { kind: "WELCOME", pattern: null, match: "CONTAINS", mediaId: null },
    });
    if (!r.ok) return;
    const existing = [
      { id: "x", kind: "WELCOME", pattern: null, match: "CONTAINS", mediaId: null },
    ];
    expect(findConflict(r.draft, existing)?.id).toBe("x");
    expect(describeTrigger({ ...existing[0]! })).toBe(KIND_LABEL.WELCOME);
  });
});

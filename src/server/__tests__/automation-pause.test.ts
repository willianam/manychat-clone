import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient, FlowSession } from "@prisma/client";

/**
 * A contact paused from the inbox gets no automation: no keyword flow, no
 * resume of a waiting question, no button tap, no story or ref-link entry.
 * Global keywords still work — "parar" must never be ignored — and the
 * pause leaves the waiting session in place for "retomar".
 */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendSenderActionToContact: vi.fn().mockResolvedValue(undefined),
  sendPrivateReply: vi.fn().mockResolvedValue({ recipientId: "IG-1", messageId: "m" }),
  SendBlocked: class SendBlocked extends Error {},
}));

vi.mock("../flow-runner", () => ({
  startFlow: vi.fn().mockResolvedValue({ status: "completed" }),
  resumeWithInput: vi.fn().mockResolvedValue({ status: "completed" }),
  resumeWithPostback: vi.fn().mockResolvedValue({ status: "completed" }),
}));

import { sendText } from "../instagram";
import { startFlow, resumeWithInput, resumeWithPostback } from "../flow-runner";
import {
  handleInboundMessage,
  handlePostback,
  handleStoryReply,
  handleStoryMention,
  handleRefLink,
  handleProfilePostback,
  handleComment,
} from "../trigger-dispatch";

const CONTACT = "contact-1";
const FLOW = "flow-1";
const TRIGGER = {
  id: "trg-1",
  flowId: FLOW,
  kind: "KEYWORD",
  pattern: "preco",
  match: "CONTAINS",
  enabled: true,
  priority: 0,
};

function fakeDb(opts: { paused: boolean; waiting?: boolean }) {
  const contact = { id: CONTACT, subscribed: true, automationPaused: opts.paused };
  const waiting = opts.waiting
    ? ({
        id: "s-wait",
        flowId: FLOW,
        contactId: CONTACT,
        currentNodeId: "q1",
        status: "WAITING_INPUT",
        context: {},
      } as unknown as FlowSession)
    : null;
  const db = {
    contact: {
      findUnique: vi.fn(async () => ({ ...contact })),
      update: vi.fn(async ({ data }: { data: object }) => Object.assign(contact, data)),
      upsert: vi.fn(async () => ({ ...contact })),
    },
    flow: { findUnique: vi.fn().mockResolvedValue({ id: FLOW, enabled: true }) },
    flowSession: {
      findFirst: vi.fn(async ({ where }: { where: { status?: unknown } }) =>
        where.status === "WAITING_INPUT" ? waiting : null,
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    trigger: {
      findMany: vi.fn().mockResolvedValue([TRIGGER]),
      findFirst: vi.fn().mockResolvedValue({ ...TRIGGER, kind: "STORY_MENTION", pattern: null }),
    },
    triggerFire: { create: vi.fn().mockResolvedValue({}) },
    refLink: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: "l1", code: "promo", flowId: FLOW, enabled: true }),
    },
    unmatchedMessage: { upsert: vi.fn().mockResolvedValue({}) },
    contactEvent: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as PrismaClient;
  return { db, contact };
}

beforeEach(() => {
  vi.mocked(sendText).mockClear();
  vi.mocked(startFlow).mockClear();
  vi.mocked(resumeWithInput).mockClear();
  vi.mocked(resumeWithPostback).mockClear();
});

describe("a paused contact", () => {
  it("does not start a keyword flow nor count an unmatched message", async () => {
    const { db } = fakeDb({ paused: true });
    await handleInboundMessage(db, CONTACT, "qual o preço?");
    await handleInboundMessage(db, CONTACT, "algo sem gatilho", { isNewContact: true });
    expect(startFlow).not.toHaveBeenCalled();
    expect(db.unmatchedMessage.upsert).not.toHaveBeenCalled();
    expect(db.trigger.findMany).not.toHaveBeenCalled();
  });

  it("does not advance a waiting question, and keeps the session for later", async () => {
    const { db } = fakeDb({ paused: true, waiting: true });
    await handleInboundMessage(db, CONTACT, "São Paulo");
    expect(resumeWithInput).not.toHaveBeenCalled();
    expect(db.flowSession.updateMany).not.toHaveBeenCalled();
  });

  it("ignores button taps, story replies, story mentions, ref links, menu taps and comments", async () => {
    const { db } = fakeDb({ paused: true, waiting: true });
    await handlePostback(db, CONTACT, "q1:opt-a");
    await handleStoryReply(db, CONTACT, "preco");
    await handleStoryMention(db, CONTACT);
    expect(await handleRefLink(db, CONTACT, "promo")).toBe(false);
    await handleProfilePostback(db, CONTACT, FLOW);
    await handleComment(db, { commentId: "c1", mediaId: "m1", text: "preco", igScopedId: "IG-1" });
    expect(resumeWithPostback).not.toHaveBeenCalled();
    expect(resumeWithInput).not.toHaveBeenCalled();
    expect(startFlow).not.toHaveBeenCalled();
  });

  it("still honours the global opt-out keyword", async () => {
    const { db, contact } = fakeDb({ paused: true });
    await handleInboundMessage(db, CONTACT, "parar");
    expect(contact.subscribed).toBe(false);
    expect(sendText).toHaveBeenCalledTimes(1);
  });
});

describe("once resumed", () => {
  it("the waiting question takes the next message", async () => {
    const { db } = fakeDb({ paused: false, waiting: true });
    await handleInboundMessage(db, CONTACT, "São Paulo");
    expect(resumeWithInput).toHaveBeenCalledTimes(1);
  });

  it("keywords fire again", async () => {
    const { db } = fakeDb({ paused: false });
    await handleInboundMessage(db, CONTACT, "preco");
    expect(startFlow).toHaveBeenCalledWith(db, FLOW, CONTACT);
  });
});

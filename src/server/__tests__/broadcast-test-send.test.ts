import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("../instagram", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  SendBlocked: class SendBlocked extends Error {},
}));
vi.mock("../flow-runner", () => ({
  startFlow: vi.fn().mockResolvedValue({ sessionId: "s1" }),
}));

import { sendBroadcastTest, parseTestDraft, TEST_POSTBACK_PREFIX } from "../broadcast-test";
import { sendMessage } from "../instagram";
import { startFlow } from "../flow-runner";

/**
 * A Prisma whose broadcast models are landmines.
 *
 * The property under test is not "the test dialog is careful" — it is that
 * the test path CANNOT write a broadcast or a recipient, because there is no
 * call to write one. Touching either model throws, so any future edit that
 * routes the test through the real send path fails here instead of in
 * somebody's follower list.
 */
/** Keys the assertion library reads while comparing objects. Not Prisma. */
const INSPECTION = new Set(["constructor", "then", "toJSON", "$$typeof", "asymmetricMatch"]);

function mineFieldDb() {
  const touched: string[] = [];
  const mine = (model: string) =>
    new Proxy(
      {},
      {
        get(_t, op) {
          // Symbols are the test runner inspecting the object (toStringTag,
          // equality hooks), not production code reaching for a model.
          if (typeof op === "symbol" || INSPECTION.has(op)) return undefined;
          touched.push(`${model}.${op}`);
          throw new Error(`o envio de teste tocou em ${model}.${op}`);
        },
      },
    );
  const db = {
    broadcast: mine("broadcast"),
    broadcastRecipient: mine("broadcastRecipient"),
  } as unknown as PrismaClient;
  return { db, touched };
}

const CONTENT = { kind: "message", text: "oi" };

beforeEach(() => vi.clearAllMocks());

describe("sendBroadcastTest", () => {
  it("sends plain text to the chosen contact and to nobody else", async () => {
    const { db, touched } = mineFieldDb();
    await sendBroadcastTest(db, { text: "promo de sexta", content: null, flowId: null, tag: null }, "c1");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      db,
      "c1",
      { text: "promo de sexta" },
      { preview: "promo de sexta", tag: undefined },
    );
    expect(touched).toEqual([]);
  });

  it("builds a content block through the same payload builder the real send uses", async () => {
    const { db, touched } = mineFieldDb();
    await sendBroadcastTest(db, { text: null, content: CONTENT, flowId: null, tag: null }, "c1");

    const [, contactId, payload] = vi.mocked(sendMessage).mock.calls[0]!;
    expect(contactId).toBe("c1");
    expect(payload).toEqual({ text: "oi" });
    expect(touched).toEqual([]);
  });

  it("carries the message tag the broadcast would go out under", async () => {
    const { db } = mineFieldDb();
    await sendBroadcastTest(
      db,
      { text: "oi", content: null, flowId: null, tag: "HUMAN_AGENT" },
      "c1",
    );
    expect(vi.mocked(sendMessage).mock.calls[0]![3]).toMatchObject({ tag: "HUMAN_AGENT" });
  });

  it("starts the flow for that one contact, with no broadcast row", async () => {
    const { db, touched } = mineFieldDb();
    await sendBroadcastTest(db, { text: null, content: null, flowId: "f1", tag: null }, "c1");

    expect(startFlow).toHaveBeenCalledWith(db, "f1", "c1", { takeover: true });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it("reports a disabled flow instead of falling back to a real send", async () => {
    vi.mocked(startFlow).mockResolvedValueOnce(null as never);
    const { db, touched } = mineFieldDb();
    await expect(
      sendBroadcastTest(db, { text: null, content: null, flowId: "f1", tag: null }, "c1"),
    ).rejects.toThrow(/desativado/);
    expect(touched).toEqual([]);
  });

  it("refuses an empty body rather than sending a blank message", async () => {
    const { db } = mineFieldDb();
    await expect(
      sendBroadcastTest(db, { text: "  ", content: null, flowId: null, tag: null }, "c1"),
    ).rejects.toThrow(/nada para testar/i);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("never reaches the drain: no code in the module mentions the send path", async () => {
    const raw = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../broadcast-test.ts", import.meta.url), "utf8"),
    );
    // Comments explain the rule; only the code has to obey it.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/broadcast-worker/);
    expect(code).not.toMatch(/enqueueBroadcast|runBroadcast|broadcastRecipient/);
    expect(code).not.toMatch(/db\.broadcast\b/);
  });
});

describe("parseTestDraft", () => {
  it("keeps the stored precedence: flow, then content, then text", () => {
    expect(
      parseTestDraft({ text: "oi", content: CONTENT, flowId: "f1", tag: null }).body,
    ).toEqual({ kind: "flow", flowId: "f1" });
    expect(parseTestDraft({ text: "oi", content: CONTENT, flowId: null, tag: null }).body).toEqual({
      kind: "content",
      content: CONTENT,
    });
    expect(parseTestDraft({ text: "oi", content: null, flowId: null, tag: null }).body).toEqual({
      kind: "text",
      text: "oi",
    });
  });

  it("rejects an unknown tag and a block the composer could not have sent", () => {
    expect(() => parseTestDraft({ text: "oi", content: null, flowId: null, tag: "NOPE" })).toThrow(
      /Tag de mensagem desconhecida/,
    );
    expect(() =>
      parseTestDraft({ text: null, content: { kind: "delay", ms: 1 }, flowId: null, tag: null }),
    ).toThrow();
  });

  it("uses a literal postback prefix, never a broadcast id", () => {
    expect(TEST_POSTBACK_PREFIX).toBe("broadcast-test");
  });
});

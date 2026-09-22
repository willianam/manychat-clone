import type { PrismaClient } from "@prisma/client";
import { sendMessage } from "./instagram";
import { broadcastPayload } from "./broadcast-payload";
import { BroadcastContent, type BroadcastBody } from "../lib/broadcast-content";
import { parseMessageTag, type MessageTag } from "../lib/messaging-window";

/**
 * Test-send a broadcast to one contact.
 *
 * A broadcast is the least reversible action in the app, and until now the
 * only way to see one was to send it to everybody. This sends the composed
 * content to a single chosen account through the same payload builders the
 * real send uses, so what arrives is what the audience would get.
 *
 * The safety property, stated plainly: this module never writes a Broadcast
 * or a BroadcastRecipient row, and never calls the drain. There is no code
 * path from here to `enqueueBroadcast` / `runBroadcast`, which is what makes
 * "a test cannot become a real send" a fact about the module rather than a
 * promise about the UI. `broadcast-test.test.ts` holds it to that with a db
 * proxy that throws if either model is touched.
 *
 * Message rows are still written — `sendMessage` owns those, and a test that
 * left no trace in the thread would be lying about what the contact received.
 */

/**
 * Postback prefix for a test. A real send uses the broadcast id; a test has
 * no broadcast, and a literal prefix keeps a tapped button from resolving to
 * any stored row.
 */
export const TEST_POSTBACK_PREFIX = "broadcast-test";

export type BroadcastTestDraft = {
  text: string | null;
  content: unknown;
  flowId: string | null;
  tag: string | null;
};

/**
 * Validate what the composer posted. Same precedence as `parseBroadcastBody`
 * (flow, then content, then text), but reading the client's draft instead of
 * a stored row — the composer's body is never trusted as-is.
 */
export function parseTestDraft(draft: BroadcastTestDraft): {
  body: BroadcastBody;
  tag: MessageTag | undefined;
} {
  const tagRaw = draft.tag?.trim() ?? "";
  const tag = tagRaw ? parseMessageTag(tagRaw) : undefined;
  if (tagRaw && !tag) throw new Error(`Tag de mensagem desconhecida: ${tagRaw}`);

  if (draft.flowId?.trim()) return { body: { kind: "flow", flowId: draft.flowId.trim() }, tag };
  if (draft.content) {
    return { body: { kind: "content", content: BroadcastContent.parse(draft.content) }, tag };
  }
  const text = draft.text?.trim();
  if (text) return { body: { kind: "text", text }, tag };
  throw new Error("Não há nada para testar: escreva a mensagem primeiro.");
}

/**
 * Deliver the composed body to one contact, now.
 *
 * Deliberately a sibling of the worker's private `deliver` rather than a
 * call into it: sharing that function would mean the test path takes a
 * broadcast id, and an id is the one thing a test must not have.
 */
export async function sendBroadcastTest(
  db: PrismaClient,
  draft: BroadcastTestDraft,
  contactId: string,
): Promise<void> {
  const { body, tag } = parseTestDraft(draft);

  if (body.kind === "flow") {
    const { startFlow } = await import("./flow-runner");
    const result = await startFlow(db, body.flowId, contactId, { takeover: true });
    if (!result) throw new Error("Fluxo desativado ou contato descadastrado.");
    return;
  }
  if (body.kind === "content") {
    const { payload, preview } = broadcastPayload(TEST_POSTBACK_PREFIX, body.content);
    await sendMessage(db, contactId, payload, { preview, tag });
    return;
  }
  await sendMessage(db, contactId, { text: body.text }, { preview: body.text, tag });
}

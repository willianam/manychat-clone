import { z } from "zod";
import { FlowNodeData } from "./flow-schema";

/**
 * What a rich broadcast carries: exactly one sending node, in the same shape
 * the flow editor produces. Reusing the node schema means the properties
 * panel, the payload builders and the limits are shared — a broadcast cannot
 * send something a flow could not.
 *
 * Postback buttons and quick replies are accepted but go nowhere: there is
 * no session to route the tap to, so the webhook ignores it. URL buttons and
 * decorative carousels work as expected.
 */
export const SENDING_KINDS = [
  "message",
  "quickreply",
  "carousel",
  "image",
  "video",
  "audio",
  "file",
  "album",
] as const;
export type SendingKind = (typeof SENDING_KINDS)[number];

export const BroadcastContent = FlowNodeData.refine(
  (d): d is Extract<FlowNodeData, { kind: SendingKind }> =>
    (SENDING_KINDS as readonly string[]).includes(d.kind),
  { message: "Um disparo precisa de um bloco que envia mensagem." },
);
export type BroadcastContent = z.infer<typeof BroadcastContent>;

/**
 * The stored form of a broadcast body, in precedence order. `parseBroadcastBody`
 * is the single place that decides which one a row means.
 */
export type BroadcastBody =
  | { kind: "flow"; flowId: string }
  | { kind: "content"; content: BroadcastContent }
  | { kind: "text"; text: string };

export function parseBroadcastBody(b: {
  text: string | null;
  content: unknown;
  flowId: string | null;
}): BroadcastBody {
  if (b.flowId) return { kind: "flow", flowId: b.flowId };
  if (b.content) return { kind: "content", content: BroadcastContent.parse(b.content) };
  if (b.text) return { kind: "text", text: b.text };
  throw new Error("Disparo sem conteúdo: informe texto, um bloco ou um fluxo.");
}

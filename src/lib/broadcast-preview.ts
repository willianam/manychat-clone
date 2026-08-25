import type { FlowGraph, FlowNodeData } from "./flow-schema";
import { BroadcastContent, SENDING_KINDS, type SendingKind } from "./broadcast-content";

/**
 * What the composer previews, in the shape PreviewPhone already renders:
 * a one-node graph. Reusing the flow preview means a broadcast looks on the
 * compose screen exactly as the same block looks inside a flow.
 */

export type ComposerBody =
  | { mode: "text"; text: string }
  | { mode: "content"; content: FlowNodeData }
  | { mode: "flow"; graph: FlowGraph | null };

const PLACEHOLDER = "Sua mensagem aparece aqui.";

export function previewGraph(body: ComposerBody): FlowGraph | null {
  switch (body.mode) {
    case "text":
      return single({ kind: "message", text: body.text.trim() || PLACEHOLDER });
    case "content":
      return single(previewable(body.content));
    case "flow":
      return body.graph;
  }
}

function single(data: FlowNodeData): FlowGraph {
  return {
    nodes: [{ id: "broadcast", type: data.kind, position: { x: 0, y: 0 }, data }],
    edges: [],
  };
}

/**
 * A block being edited is often invalid for a moment (empty text, a card
 * without a title). The preview must still draw something, so blanks are
 * filled with placeholders before rendering; the real block is validated by
 * `contentIssues` separately.
 */
function previewable(d: FlowNodeData): FlowNodeData {
  switch (d.kind) {
    case "message":
      return { ...d, text: d.text.trim() || PLACEHOLDER };
    case "quickreply":
      return {
        ...d,
        text: d.text.trim() || PLACEHOLDER,
        options: d.options.map((o, i) => ({ ...o, title: o.title.trim() || `Opção ${i + 1}` })),
      };
    case "carousel":
      return {
        ...d,
        cards: d.cards.map((c, i) => ({ ...c, title: c.title.trim() || `Card ${i + 1}` })),
      };
    default:
      return d;
  }
}

/** Human-readable reasons a block cannot be sent yet. Empty = sendable. */
export function contentIssues(d: FlowNodeData): string[] {
  const r = BroadcastContent.safeParse(d);
  if (r.success) return [];
  const seen = new Set<string>();
  for (const issue of r.error.issues) {
    const path = issue.path.length ? describePath(issue.path) : null;
    seen.add(path ? `${path}: ${translate(issue.message)}` : translate(issue.message));
  }
  return [...seen];
}

export function isSendingKind(kind: string): kind is SendingKind {
  return (SENDING_KINDS as readonly string[]).includes(kind);
}

const PATH_LABEL: Record<string, string> = {
  text: "texto",
  url: "URL",
  caption: "legenda",
  options: "opções",
  title: "título",
  cards: "cards",
  buttons: "botões",
  imageUrl: "imagem",
  subtitle: "subtítulo",
};

function describePath(path: PropertyKey[]): string {
  return path
    .map((p) => (typeof p === "number" ? `#${p + 1}` : (PATH_LABEL[String(p)] ?? String(p))))
    .join(" ");
}

/** Zod's default English messages, for the handful the editor can produce. */
function translate(message: string): string {
  if (/at least 1 character/i.test(message)) return "não pode ficar vazio";
  if (/at most (\d+) character/i.test(message)) {
    return message.replace(/.*at most (\d+) character.*/i, "no máximo $1 caracteres");
  }
  if (/invalid url/i.test(message)) return "precisa ser um endereço https válido";
  if (/at least 1 element/i.test(message)) return "precisa de ao menos um item";
  if (/at most (\d+) element/i.test(message)) {
    return message.replace(/.*at most (\d+) element.*/i, "no máximo $1 itens");
  }
  return message;
}

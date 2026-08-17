import { z } from "zod";

/**
 * The flow document. This is exactly what React Flow persists, so the
 * editor and the runner share one source of truth — no translation layer
 * that can drift.
 *
 * Node kinds:
 *   message   — send text (optionally with buttons), continue
 *   question  — send text, wait for a free-text reply, store in context
 *   quickreply— send text with tappable options, store the tapped one
 *   carousel  — horizontally scrolling cards, each with its own buttons
 *   image     — send an image, continue
 *   condition — branch on a context value; edges carry "true" / "false"
 *   delay     — pause, optionally only resuming inside an allowed hour window
 *   action    — add/remove tags and set fields without sending anything
 *   random    — split traffic between outputs, for A/B comparison
 *   tag       — legacy: kept so existing flows keep running; action supersedes it
 *   end       — terminate the session
 *
 * The numeric caps below are Instagram's, not ours — see LIMITS. Enforcing
 * them here means a bad flow fails in the editor rather than at send time,
 * where it would strand a live conversation.
 */

/** Instagram messaging limits, verified against the v26.0 platform docs. */
export const LIMITS = {
  /** Quick replies per message; titles are truncated past 20 chars. */
  quickReplies: 13,
  quickReplyTitle: 20,
  /** Buttons on a button template. */
  buttons: 3,
  /** Text above the buttons on a button template. */
  buttonTemplateText: 640,
  /** Cards in a generic-template carousel, and buttons per card. */
  carouselCards: 10,
  carouselButtons: 3,
  /** Plain message text. */
  messageText: 1000,
} as const;

export const NodeKind = z.enum([
  "message",
  "question",
  "quickreply",
  "carousel",
  "image",
  "condition",
  "delay",
  "action",
  "random",
  "tag",
  "end",
]);
export type NodeKind = z.infer<typeof NodeKind>;

/**
 * A button. Instagram only supports two types: `postback`, which routes to
 * another node, and `url`, which opens a link. ManyChat's `call` and `buy`
 * have no Instagram equivalent — use a `tel:` or checkout URL instead.
 */
export const FlowButton = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("postback"),
    /** Stable id; also the edge sourceHandle and the postback payload. */
    id: z.string().min(1),
    title: z.string().min(1).max(20),
  }),
  z.object({
    type: z.literal("url"),
    id: z.string().min(1),
    title: z.string().min(1).max(20),
    url: z.string().url(),
  }),
]);
export type FlowButton = z.infer<typeof FlowButton>;

const MessageData = z.object({
  kind: z.literal("message"),
  text: z.string().min(1).max(LIMITS.messageText),
  /** With buttons the text goes through a button template, capped at 640. */
  buttons: z.array(FlowButton).max(LIMITS.buttons).optional(),
});

const QuestionData = z.object({
  kind: z.literal("question"),
  text: z.string().min(1).max(LIMITS.messageText),
  /** Context key the reply is written to. */
  saveAs: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
});

const QuickReplyOption = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(LIMITS.quickReplyTitle),
  /** Stored in context[saveAs] when tapped; defaults to the title. */
  value: z.string().optional(),
});

const QuickReplyData = z.object({
  kind: z.literal("quickreply"),
  text: z.string().min(1).max(LIMITS.messageText),
  saveAs: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  options: z.array(QuickReplyOption).min(1).max(LIMITS.quickReplies),
});

const CarouselCard = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(80),
  subtitle: z.string().max(80).optional(),
  imageUrl: z.string().url().optional(),
  buttons: z.array(FlowButton).max(LIMITS.carouselButtons).optional(),
});

const CarouselData = z.object({
  kind: z.literal("carousel"),
  cards: z.array(CarouselCard).min(1).max(LIMITS.carouselCards),
  /** Persisted so each node remembers how the user left it on the canvas. */
  expanded: z.boolean().optional(),
});

const ImageData = z.object({
  kind: z.literal("image"),
  url: z.string().url(),
  caption: z.string().max(LIMITS.messageText).optional(),
});

export const ConditionOp = z.enum([
  "equals",
  "contains",
  "exists",
  "gt",
  "lt",
  "hasTag",
]);

const ConditionData = z.object({
  kind: z.literal("condition"),
  /** Context key, or tag name when op is hasTag. */
  key: z.string().min(1),
  op: ConditionOp,
  value: z.string().optional(),
});

/**
 * Delay. `window` restricts *when* the flow may resume — a 20h delay set at
 * 3am would otherwise wake the conversation at 11pm. Hours are 0–23 in the
 * account's timezone.
 */
const DelayData = z.object({
  kind: z.literal("delay"),
  seconds: z.number().int().min(1).max(60 * 60 * 24 * 30),
  window: z
    .object({
      fromHour: z.number().int().min(0).max(23),
      toHour: z.number().int().min(0).max(23),
    })
    .optional(),
});

/** Field writes are typed, so conditions can compare numbers and dates. */
export const FieldOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("addTag"), tagName: z.string().min(1) }),
  z.object({ op: z.literal("removeTag"), tagName: z.string().min(1) }),
  z.object({
    op: z.literal("setField"),
    key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
    value: z.string(),
    valueType: z.enum(["text", "number", "date", "boolean"]).default("text"),
  }),
  z.object({
    op: z.literal("unsetField"),
    key: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  }),
]);
export type FieldOp = z.infer<typeof FieldOp>;

const ActionData = z.object({
  kind: z.literal("action"),
  ops: z.array(FieldOp).min(1).max(10),
});

const RandomData = z.object({
  kind: z.literal("random"),
  /** Percentages per branch; must sum to 100. Handles are "0", "1", … */
  weights: z.array(z.number().int().min(1).max(100)).min(2).max(4),
});

/** Superseded by `action`, kept so flows built before it keep running. */
const TagData = z.object({
  kind: z.literal("tag"),
  action: z.enum(["add", "remove"]),
  tagName: z.string().min(1),
});

const EndData = z.object({ kind: z.literal("end") });

export const FlowNodeData = z.discriminatedUnion("kind", [
  MessageData,
  QuestionData,
  QuickReplyData,
  CarouselData,
  ImageData,
  ConditionData,
  DelayData,
  ActionData,
  RandomData,
  TagData,
  EndData,
]);
export type FlowNodeData = z.infer<typeof FlowNodeData>;

export const FlowNode = z.object({
  id: z.string().min(1),
  type: NodeKind,
  position: z.object({ x: z.number(), y: z.number() }),
  data: FlowNodeData,
});

export const FlowEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  /**
   * Which output the edge leaves from:
   *   condition → "true" | "false"
   *   random    → "0" | "1" | …
   *   buttons / quick replies → the option's id
   *   everything else → absent
   */
  sourceHandle: z.string().nullish(),
});

export const FlowGraph = z.object({
  nodes: z.array(FlowNode).min(1),
  edges: z.array(FlowEdge),
});
export type FlowGraph = z.infer<typeof FlowGraph>;

export type FlowIssue = { level: "error" | "warning"; message: string };

/** Every named output a node exposes, in canvas order. */
export function outputsOf(node: z.infer<typeof FlowNode>): Array<{ handle: string; label: string }> {
  const d = node.data;
  switch (d.kind) {
    case "condition":
      return [
        { handle: "true", label: "sim" },
        { handle: "false", label: "não" },
      ];
    case "random":
      return d.weights.map((w, i) => ({ handle: String(i), label: `${w}%` }));
    case "quickreply":
      return d.options.map((o) => ({ handle: o.id, label: o.title }));
    case "message":
      return (d.buttons ?? [])
        .filter((b) => b.type === "postback")
        .map((b) => ({ handle: b.id, label: b.title }));
    case "carousel":
      return d.cards.flatMap((c) =>
        (c.buttons ?? [])
          .filter((b) => b.type === "postback")
          .map((b) => ({ handle: b.id, label: `${c.title}: ${b.title}` })),
      );
    case "end":
      return [];
    default:
      return [{ handle: "", label: "" }];
  }
}

/**
 * Structural validation beyond shape. The editor calls this before save so
 * a broken graph never reaches the runner, where a dangling edge would
 * strand a live conversation.
 */
export function validateGraph(graph: FlowGraph): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));

  if (ids.size !== graph.nodes.length) {
    issues.push({ level: "error", message: "Há nós com o mesmo id." });
  }

  for (const e of graph.edges) {
    if (!ids.has(e.source)) {
      issues.push({ level: "error", message: `A ligação ${e.id} sai de um nó que não existe.` });
    }
    if (!ids.has(e.target)) {
      issues.push({ level: "error", message: `A ligação ${e.id} aponta para um nó que não existe.` });
    }
  }

  const targets = new Set(graph.edges.map((e) => e.target));
  const roots = graph.nodes.filter((n) => !targets.has(n.id));
  if (roots.length === 0) {
    issues.push({
      level: "error",
      message: "Nenhum nó de entrada — o fluxo é um ciclo fechado e nunca começa.",
    });
  }
  if (roots.length > 1) {
    issues.push({
      level: "warning",
      message: `${roots.length} nós de entrada; o fluxo começa em "${roots[0]?.id}".`,
    });
  }

  for (const n of graph.nodes) {
    const out = graph.edges.filter((e) => e.source === n.id);
    const d = n.data;

    if (d.kind === "condition") {
      const handles = new Set(out.map((e) => e.sourceHandle));
      if (!handles.has("true") || !handles.has("false")) {
        issues.push({
          level: "error",
          message: `A condição "${n.id}" precisa dos dois caminhos: sim e não.`,
        });
      }
      continue;
    }

    if (d.kind === "random") {
      const sum = d.weights.reduce((a, b) => a + b, 0);
      if (sum !== 100) {
        issues.push({
          level: "error",
          message: `As porcentagens do randomizador "${n.id}" somam ${sum}%, deveriam somar 100%.`,
        });
      }
      continue;
    }

    if (d.kind === "message" && d.buttons?.length) {
      if (d.text.length > LIMITS.buttonTemplateText) {
        issues.push({
          level: "error",
          message: `Com botões, o texto cabe ${LIMITS.buttonTemplateText} caracteres — este tem ${d.text.length}.`,
        });
      }
    }

    if (d.kind === "quickreply") {
      const unlinked = d.options.filter(
        (o) => !out.some((e) => e.sourceHandle === o.id),
      );
      if (unlinked.length) {
        issues.push({
          level: "warning",
          message: `Opções sem caminho em "${n.id}": ${unlinked.map((o) => o.title).join(", ")}.`,
        });
      }
      continue;
    }

    // Everything else: a node with no way out silently ends the conversation.
    if (d.kind !== "end" && out.length === 0) {
      issues.push({
        level: "warning",
        message: `O nó "${n.id}" não leva a lugar nenhum; a conversa para aí.`,
      });
    }
  }

  return issues;
}

/** The node the runner starts from: first node with no inbound edge. */
export function findEntryNode(graph: FlowGraph): string | null {
  const targets = new Set(graph.edges.map((e) => e.target));
  return graph.nodes.find((n) => !targets.has(n.id))?.id ?? null;
}

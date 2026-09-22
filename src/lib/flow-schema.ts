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
 *   video     — send a video, continue
 *   audio     — send an audio clip, continue
 *   file      — send a PDF, continue
 *   album     — send up to 10 images as one multi-attachment message
 *   condition — branch on a context value; edges carry "true" / "false"
 *   delay     — pause, optionally only resuming inside an allowed hour window
 *   action    — add/remove tags and set fields without sending anything
 *   random    — split traffic between outputs, for A/B comparison
 *   tag       — legacy: kept so existing flows keep running; action supersedes it
 *   goto      — jump to another node in this flow, or hand the contact to another flow
 *   goal      — record a conversion when passed through, then continue
 *   request   — call an external HTTP API, map the JSON response into contact fields
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
  /** Plain message text. Meta counts BYTES, not characters. */
  messageText: 1000,
  /**
   * Media ceilings, in megabytes, from the Instagram messaging docs:
   * image (PNG/JPEG) 8 MB; audio, video and file (PDF) 25 MB each.
   *
   * We cannot measure a remote file from the editor, so these are shown as
   * guidance next to the URL field rather than enforced — the only honest
   * option short of downloading every URL the user pastes.
   */
  imageMb: 8,
  mediaMb: 25,
  /** Attachments in one multi-attachment (album) message. */
  albumImages: 10,
} as const;

/** File extensions Instagram accepts per media kind, for editor hints. */
export const MEDIA_FORMATS = {
  image: "PNG, JPEG",
  video: "MP4, OGG, AVI, MOV, WEBM",
  audio: "AAC, M4A, WAV, MP4",
  file: "PDF",
} as const;

/**
 * Meta's text limits are in UTF-8 bytes, not characters.
 *
 * This matters in Portuguese: "á" costs 2 bytes and an emoji costs 4, so a
 * message that looks like 900 characters can be 1800 bytes and get rejected
 * at send time — after the flow already committed to it.
 */
export const byteLength = (s: string): number =>
  typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(s).length
    : Buffer.byteLength(s, "utf8");

/** Zod refinement: caps a string by its UTF-8 byte length. */
const withinBytes = (limit: number) => (v: string) => byteLength(v) <= limit;

export const NodeKind = z.enum([
  "message",
  "question",
  "quickreply",
  "carousel",
  "image",
  "video",
  "audio",
  "file",
  "album",
  "condition",
  "delay",
  "action",
  "random",
  "tag",
  "goto",
  "goal",
  "request",
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
  text: z
    .string()
    .min(1)
    .refine(withinBytes(LIMITS.messageText), {
      message: `O texto passa de ${LIMITS.messageText} bytes (acentos contam 2, emoji 4).`,
    }),
  /** With buttons the text goes through a button template, capped at 640. */
  buttons: z.array(FlowButton).max(LIMITS.buttons).optional(),
});

/** What a question accepts. `option` means "one of `options`", by title or value. */
export const InputType = z.enum(["text", "number", "email", "phone", "date", "option"]);
export type InputType = z.infer<typeof InputType>;

/**
 * Question. Every validation field is optional so a question saved before
 * they existed still parses as the free-text question it was.
 *
 *   inputType          what the reply must look like; `text` accepts anything
 *   validationMessage  sent instead of the question when the reply fails
 *   maxAttempts        invalid replies tolerated before giving up (default 3)
 *   allowSkip          adds a "Pular" quick reply; skipping stores nothing
 *   onInvalid          `retry` re-asks until maxAttempts, then leaves by the
 *                      `invalid` handle (or the default path when unwired);
 *                      `branch` leaves by `invalid` on the first failure
 */
const QuestionData = z.object({
  kind: z.literal("question"),
  text: z
    .string()
    .min(1)
    .refine(withinBytes(LIMITS.messageText), {
      message: `O texto passa de ${LIMITS.messageText} bytes (acentos contam 2, emoji 4).`,
    }),
  /** Context key the reply is written to. */
  saveAs: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  inputType: InputType.optional(),
  /** Accepted answers when inputType is `option`. */
  options: z.array(z.string().min(1)).max(LIMITS.quickReplies).optional(),
  validationMessage: z
    .string()
    .refine(withinBytes(LIMITS.messageText), {
      message: `O texto passa de ${LIMITS.messageText} bytes (acentos contam 2, emoji 4).`,
    })
    .optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  allowSkip: z.boolean().optional(),
  onInvalid: z.enum(["retry", "branch"]).optional(),
});

const QuickReplyOption = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(LIMITS.quickReplyTitle),
  /** Stored in context[saveAs] when tapped; defaults to the title. */
  value: z.string().optional(),
});

const QuickReplyData = z.object({
  kind: z.literal("quickreply"),
  text: z
    .string()
    .min(1)
    .refine(withinBytes(LIMITS.messageText), {
      message: `O texto passa de ${LIMITS.messageText} bytes (acentos contam 2, emoji 4).`,
    }),
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

/**
 * Media source: a public URL, or an id from uploading the file to Meta.
 *
 * The upload path exists because hosting a file somewhere just to send it
 * is friction with no upside — and an uploaded id is reusable, so sending
 * the same audio to a thousand contacts costs one upload.
 */
const mediaSourceFields = {
  url: z.string().url().optional(),
  attachmentId: z.string().min(1).optional(),
};

/** A media node's own fields plus the source pair, with "at least one" enforced once. */
function withMediaSource<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...mediaSourceFields, ...shape })
    .refine((v) => Boolean(v.url) || Boolean(v.attachmentId), {
      message: "Envie um arquivo ou informe uma URL.",
    });
}

const ImageData = withMediaSource({
  kind: z.literal("image"),
  caption: z.string().max(LIMITS.messageText).optional(),
});

/**
 * Video, audio and file share one shape: a public https URL.
 *
 * They are separate kinds rather than one `media` kind with a type field
 * because the canvas, the properties panel and the palette all need to say
 * what the block *is* — "Vídeo" and "PDF" are different decisions to a person
 * building a flow, even though the wire format differs only by one string.
 *
 * A caption is deliberately absent: unlike an image node (whose caption is
 * only an inbox preview here), Instagram sends the attachment alone, so a
 * caption would silently never ship.
 */
const VideoData = withMediaSource({ kind: z.literal("video") });

const AudioData = withMediaSource({ kind: z.literal("audio") });

/** Documents. Instagram accepts PDF only, so the schema says so. */
const FileData = withMediaSource({
  kind: z.literal("file"),
  /** Shown on the canvas so the block is identifiable without opening it. */
  filename: z.string().max(120).optional(),
});

/**
 * Album: up to ten images delivered as one message, via the `attachments`
 * array rather than the singular `attachment` key.
 */
const AlbumData = z.object({
  kind: z.literal("album"),
  urls: z.array(z.string().url()).min(1).max(LIMITS.albumImages),
});

export const ConditionOp = z.enum([
  "equals",
  "contains",
  "exists",
  "gt",
  "lt",
  /** Date-only ordering; false when either side is not a date. */
  "before",
  "after",
  "hasTag",
  "notHasTag",
  /** Numbers or dates; value is "min,max", both inclusive. */
  "between",
  "startsWith",
  "isEmpty",
  /** A date field within the last N days (value = N), today included. */
  "inLastDays",
  /** The contact's subscription flag; key is ignored. */
  "subscribed",
]);
export type ConditionOp = z.infer<typeof ConditionOp>;

/** One test. `key` is a context key, a tag name for the tag ops, or unused. */
export const ConditionRule = z.object({
  key: z.string(),
  op: ConditionOp,
  value: z.string().optional(),
});
export type ConditionRule = z.infer<typeof ConditionRule>;

/**
 * Condition. A single rule lives on `key`/`op`/`value`, as it always has.
 * `rules` with a `combinator` makes it compound; when present they replace
 * the single rule, which is kept only so old graphs and the current editor
 * keep working.
 */
const ConditionData = z.object({
  kind: z.literal("condition"),
  /** Context key, or tag name when op is hasTag. */
  key: z.string().min(1),
  op: ConditionOp,
  value: z.string().optional(),
  rules: z.array(ConditionRule).min(1).max(10).optional(),
  combinator: z.enum(["and", "or"]).optional(),
});

/** The rules a condition actually tests: `rules` when set, else the single one. */
export function rulesOf(d: {
  key: string;
  op: ConditionOp;
  value?: string;
  rules?: ConditionRule[];
}): ConditionRule[] {
  return d.rules?.length ? d.rules : [{ key: d.key, op: d.op, value: d.value }];
}

/**
 * Delay. Three modes:
 *
 *   fixed      wait `seconds`; `window` restricts *when* the flow may resume
 *              (a 20h delay set at 3am would otherwise wake the conversation
 *              at 11pm — hours are 0–23 in the account's timezone). With
 *              `cancelOnReply` a message from the contact cuts the wait short
 *              and leaves by the "replied" handle.
 *   untilReply pause until the contact sends anything; an optional
 *              `timeoutSeconds` leaves by the "timeout" handle instead.
 *   untilDate  resume at `untilDate` ("YYYY-MM-DDTHH:mm", account timezone);
 *              a date already past continues immediately.
 *
 * `mode` is optional so every delay saved before it existed is a fixed one.
 */
const DelaySeconds = z
  .number()
  .int()
  .min(1)
  .max(60 * 60 * 24 * 30);

const DelayData = z
  .object({
    kind: z.literal("delay"),
    mode: z.enum(["fixed", "untilReply", "untilDate"]).optional(),
    seconds: DelaySeconds.optional(),
    window: z
      .object({
        fromHour: z.number().int().min(0).max(23),
        toHour: z.number().int().min(0).max(23),
      })
      .optional(),
    cancelOnReply: z.boolean().optional(),
    timeoutSeconds: DelaySeconds.optional(),
    untilDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .optional(),
  })
  .refine((v) => (v.mode ?? "fixed") !== "fixed" || v.seconds !== undefined, {
    message: "Informe quantos segundos esperar.",
  })
  .refine((v) => v.mode !== "untilDate" || Boolean(v.untilDate), {
    message: "Informe a data e a hora para continuar.",
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
  /** Stop all automated messages to this contact until they opt back in. */
  z.object({ op: z.literal("unsubscribe") }),
  z.object({ op: z.literal("resubscribe") }),
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
  /** Optional name per arm ("Versão A"), parallel to `weights`, for reports. */
  labels: z.array(z.string().max(40)).max(4).optional(),
});

/** The display name of a randomizer arm: its label, or "Saída N". */
export function armLabel(d: { labels?: string[] }, i: number): string {
  return d.labels?.[i]?.trim() || `Saída ${i + 1}`;
}

/** Superseded by `action`, kept so flows built before it keep running. */
const TagData = z.object({
  kind: z.literal("tag"),
  action: z.enum(["add", "remove"]),
  tagName: z.string().min(1),
});

/**
 * Go To. A node target jumps inside this flow; a flow target completes the
 * current session and starts the other flow from its entry node. Either way
 * the goto has no outputs of its own.
 */
export const GotoTarget = z.union([
  z.object({ nodeId: z.string().min(1) }),
  z.object({ flowId: z.string().min(1) }),
]);
export type GotoTarget = z.infer<typeof GotoTarget>;

const GotoData = z.object({
  kind: z.literal("goto"),
  target: GotoTarget,
});

/** Goal: a named conversion point. Passing through records a FlowGoalHit. */
const GoalData = z.object({
  kind: z.literal("goal"),
  name: z.string().trim().min(1).max(80),
});

/**
 * External request. URL, headers and body are templates: `{{campo}}` reads
 * the session/contact context, `{{secret.NOME}}` reads env FLOW_SECRET_NOME
 * so a token never sits in the flow document. `mapping` copies parts of the
 * JSON reply ("data.items[0].price") into contact fields. Leaves by
 * "success" on a 2xx, "error" otherwise — including timeout and blocked URL.
 */
const RequestData = z.object({
  kind: z.literal("request"),
  method: z.enum(["GET", "POST"]),
  url: z.string().min(1).max(2000),
  headers: z
    .array(z.object({ name: z.string().min(1).max(100), value: z.string().max(2000) }))
    .max(20)
    .optional(),
  /** JSON text with `{{}}` templates, sent on POST. */
  body: z.string().max(10_000).optional(),
  mapping: z
    .array(
      z.object({
        path: z.string().min(1).max(200),
        field: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
      }),
    )
    .max(20)
    .optional(),
});

const EndData = z.object({ kind: z.literal("end") });

// A refined member can't live in a discriminatedUnion, and media nodes
// need a refinement (url OR attachmentId), so this is a plain union.
export const FlowNodeData = z.union([
  MessageData,
  QuestionData,
  QuickReplyData,
  CarouselData,
  ImageData,
  VideoData,
  AudioData,
  FileData,
  AlbumData,
  ConditionData,
  DelayData,
  ActionData,
  RandomData,
  TagData,
  GotoData,
  GoalData,
  RequestData,
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
   *   default path → "next" (taken when the contact taps nothing)
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
export function outputsOf(
  node: z.infer<typeof FlowNode>,
): Array<{ handle: string; label: string }> {
  const d = node.data;
  switch (d.kind) {
    case "condition":
      return [
        { handle: "true", label: "sim" },
        { handle: "false", label: "não" },
      ];
    case "random":
      return d.weights.map((w, i) => ({
        handle: String(i),
        label: d.labels?.[i]?.trim() ? `${armLabel(d, i)} · ${w}%` : `${w}%`,
      }));
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
    case "question":
      return d.onInvalid === "branch"
        ? [
            { handle: "next", label: "resposta" },
            { handle: "invalid", label: "inválida" },
          ]
        : [{ handle: "", label: "" }];
    case "delay":
      if ((d.mode ?? "fixed") === "fixed" && d.cancelOnReply) {
        return [
          { handle: "next", label: "depois" },
          { handle: "replied", label: "respondeu" },
        ];
      }
      if (d.mode === "untilReply" && d.timeoutSeconds) {
        return [
          { handle: "next", label: "respondeu" },
          { handle: "timeout", label: "tempo esgotado" },
        ];
      }
      return [{ handle: "", label: "" }];
    case "request":
      return [
        { handle: "success", label: "sucesso" },
        { handle: "error", label: "erro" },
      ];
    case "goto":
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
      issues.push({
        level: "error",
        message: `A ligação ${e.id} aponta para um nó que não existe.`,
      });
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

    if (d.kind === "delay") {
      const extra =
        (d.mode ?? "fixed") === "fixed" && d.cancelOnReply
          ? "replied"
          : d.mode === "untilReply" && d.timeoutSeconds
            ? "timeout"
            : null;
      if (extra && !out.some((e) => e.sourceHandle === extra)) {
        issues.push({
          level: "warning",
          message: `A saída "${extra === "replied" ? "respondeu" : "tempo esgotado"}" do atraso "${n.id}" não está ligada; segue pelo caminho normal.`,
        });
      }
    }

    if (d.kind === "request") {
      const handles = new Set(out.map((e) => e.sourceHandle));
      if (!handles.has("success")) {
        issues.push({
          level: "error",
          message: `A requisição "${n.id}" precisa da saída "sucesso" ligada.`,
        });
      }
      if (!handles.has("error")) {
        issues.push({
          level: "warning",
          message: `A saída "erro" da requisição "${n.id}" não está ligada; uma falha encerra a conversa.`,
        });
      }
      continue;
    }

    if (d.kind === "goto") {
      if ("nodeId" in d.target && !ids.has(d.target.nodeId)) {
        issues.push({
          level: "error",
          message: `O salto "${n.id}" aponta para um passo que não existe (${d.target.nodeId}).`,
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
      const bytes = byteLength(d.text);
      if (bytes > LIMITS.buttonTemplateText) {
        issues.push({
          level: "error",
          message: `Com botões, o texto cabe ${LIMITS.buttonTemplateText} bytes — este tem ${bytes} (acentos contam 2, emoji 4).`,
        });
      }
    }

    if (d.kind === "question") {
      if (d.inputType === "option" && !d.options?.length) {
        issues.push({
          level: "error",
          message: `A pergunta "${n.id}" pede uma opção mas não lista nenhuma.`,
        });
      }
      if (d.onInvalid === "branch" && !out.some((e) => e.sourceHandle === "invalid")) {
        issues.push({
          level: "error",
          message: `A pergunta "${n.id}" desvia respostas inválidas, mas a saída "inválida" não está ligada.`,
        });
      }
    }

    if (d.kind === "quickreply") {
      const unlinked = d.options.filter((o) => !out.some((e) => e.sourceHandle === o.id));
      if (unlinked.length) {
        issues.push({
          level: "warning",
          message: `Opções sem caminho em "${n.id}": ${unlinked.map((o) => o.title).join(", ")}.`,
        });
      }
      continue;
    }

    // A node with no way out — by button or by default path — silently ends
    // the conversation.
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

import type { PrismaClient, FlowSession, Prisma } from "@prisma/client";
import { FlowGraph, findEntryNode, type FlowNodeData } from "../lib/flow-schema";
import { sendText, sendMessage, sendSenderActionToContact } from "./instagram";
import {
  buildMessage, buildQuickReply, buildCarousel, buildImage,
  buildMedia, buildAlbum,
  previewOf, resumeAtFor, parsePostback,
} from "./message-payload";

/** Session context values. Prisma's Json input type needs the cast. */
type Ctx = Record<string, unknown>;
const asJson = (ctx: Ctx) => ctx as Prisma.InputJsonValue;

/**
 * Executes flows against durable per-contact state.
 *
 * The invariant: every await that touches the outside world is followed by
 * a state write, so a crash resumes from the last completed node rather
 * than replaying sends. Sessions are keyed (contact, flow, ACTIVE) at the
 * DB level, so a double webhook can't start two parallel runs.
 */

const MAX_STEPS = 50; // cycle guard — a graph loop would otherwise spin forever

/** Node kinds that put a message on the wire, and so deserve a typing bubble. */
const SENDS_MESSAGE: ReadonlySet<FlowNodeData["kind"]> = new Set([
  "message", "question", "quickreply", "carousel",
  "image", "video", "audio", "file", "album",
]);

export type StepResult = { status: "waiting" | "completed" | "delayed"; nodeId?: string };

export async function startFlow(
  db: PrismaClient,
  flowId: string,
  contactId: string,
): Promise<StepResult | null> {
  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow || !flow.enabled) return null;

  const graph = FlowGraph.parse(flow.graph);
  const entry = findEntryNode(graph);
  if (!entry) return null;

  // If this contact is already mid-flow here, don't start a second run.
  const existing = await db.flowSession.findFirst({
    where: { contactId, flowId, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
  });
  if (existing) return { status: "waiting", nodeId: existing.currentNodeId ?? undefined };

  const session = await db.flowSession.create({
    data: { flowId, contactId, currentNodeId: entry, status: "ACTIVE", context: {} },
  });

  return advance(db, session, graph);
}

/**
 * Feed an inbound message to a session parked on a question node.
 */
export async function resumeWithInput(
  db: PrismaClient,
  session: FlowSession,
  input: string,
): Promise<StepResult> {
  const flow = await db.flow.findUniqueOrThrow({ where: { id: session.flowId } });
  const graph = FlowGraph.parse(flow.graph);

  const node = graph.nodes.find((n) => n.id === session.currentNodeId);
  if (node?.data.kind === "question") {
    const ctx: Ctx = { ...(session.context as Ctx), [node.data.saveAs]: input };
    await db.contactField.upsert({
      where: { contactId_key: { contactId: session.contactId, key: node.data.saveAs } },
      create: { contactId: session.contactId, key: node.data.saveAs, value: input },
      update: { value: input },
    });
    session = await db.flowSession.update({
      where: { id: session.id },
      data: { context: asJson(ctx), status: "ACTIVE", currentNodeId: nextOf(graph, node.id) },
    });
  }

  return advance(db, session, graph);
}

/**
 * Resume a session parked on a button or quick reply.
 *
 * The postback payload names both the node and the chosen handle, so we can
 * verify the tap belongs to where the contact actually is — a stale button
 * from three messages ago must not jump the conversation backwards.
 */
export async function resumeWithPostback(
  db: PrismaClient,
  session: FlowSession,
  payload: string,
): Promise<StepResult | null> {
  const parsed = parsePostback(payload);
  if (!parsed) return null;
  if (session.currentNodeId && parsed.nodeId !== session.currentNodeId) return null;

  const flow = await db.flow.findUniqueOrThrow({ where: { id: session.flowId } });
  const graph = FlowGraph.parse(flow.graph);
  const node = graph.nodes.find((n) => n.id === parsed.nodeId);
  if (!node) return null;

  const ctx: Ctx = { ...(session.context as Ctx) };

  // A quick reply doubles as a question: record what was chosen.
  if (node.data.kind === "quickreply") {
    const opt = node.data.options.find((o) => o.id === parsed.handle);
    if (opt) {
      const value = opt.value ?? opt.title;
      ctx[node.data.saveAs] = value;
      await db.contactField.upsert({
        where: { contactId_key: { contactId: session.contactId, key: node.data.saveAs } },
        create: { contactId: session.contactId, key: node.data.saveAs, value },
        update: { value },
      });
    }
  }

  const updated = await db.flowSession.update({
    where: { id: session.id },
    data: {
      status: "ACTIVE",
      context: asJson(ctx),
      currentNodeId: nextOf(graph, parsed.nodeId, parsed.handle),
    },
  });

  return advance(db, updated, graph);
}

/** Walk the graph until it blocks (question / delay) or ends. */
async function advance(
  db: PrismaClient,
  session: FlowSession,
  graph: FlowGraph,
): Promise<StepResult> {
  let current = session.currentNodeId;
  // Stored contact fields are readable by {{name}} alongside session answers,
  // so a flow can greet by a name captured weeks ago in a different flow.
  // Session context wins on conflict — see loadContactFields.
  const ctx: Ctx = await loadContactFields(
    db,
    session.contactId,
    { ...(session.context as Ctx) },
  );

  for (let step = 0; step < MAX_STEPS; step++) {
    if (!current) break;
    const node = graph.nodes.find((n) => n.id === current);
    if (!node) break;

    const d: FlowNodeData = node.data;

    // Typing bubble before anything that actually sends.
    //
    // Done once here rather than at each send site so a new sending node kind
    // cannot forget it. Silent nodes (condition, action, random, delay, end)
    // are excluded: a typing indicator that precedes no message is a lie, and
    // costs an API call on a webhook with a 15s budget.
    //
    // Instagram clears the indicator when the message lands, so there is no
    // matching typing_off — sending one would race the message and can blank
    // the bubble early.
    if (SENDS_MESSAGE.has(d.kind)) {
      await sendSenderActionToContact(db, session.contactId, "typing_on");
    }

    if (d.kind === "end") {
      await db.flowSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", currentNodeId: null, context: asJson(ctx) },
      });
      return { status: "completed" };
    }

    if (d.kind === "message") {
      const withText = { ...d, text: interpolate(d.text, ctx) };
      await sendMessage(db, session.contactId, buildMessage(node.id, withText), {
        preview: withText.text,
      });

      // Buttons make this a branch point: the conversation waits for a tap
      // rather than walking on, exactly like a question waits for text.
      if (d.buttons?.some((b) => b.type === "postback")) {
        await db.flowSession.update({
          where: { id: session.id },
          data: { status: "WAITING_INPUT", currentNodeId: node.id, context: asJson(ctx) },
        });
        return { status: "waiting", nodeId: node.id };
      }

      current = nextOf(graph, node.id);
      await db.flowSession.update({
        where: { id: session.id },
        data: { currentNodeId: current, context: asJson(ctx) },
      });
      continue;
    }

    if (d.kind === "quickreply") {
      const withText = { ...d, text: interpolate(d.text, ctx) };
      await sendMessage(db, session.contactId, buildQuickReply(node.id, withText), {
        preview: withText.text,
      });
      await db.flowSession.update({
        where: { id: session.id },
        data: { status: "WAITING_INPUT", currentNodeId: node.id, context: asJson(ctx) },
      });
      return { status: "waiting", nodeId: node.id };
    }

    if (d.kind === "carousel") {
      await sendMessage(db, session.contactId, buildCarousel(node.id, d), {
        preview: previewOf(d),
      });
      // Cards with postback buttons wait for a tap; decorative ones walk on.
      if (d.cards.some((c) => c.buttons?.some((b) => b.type === "postback"))) {
        await db.flowSession.update({
          where: { id: session.id },
          data: { status: "WAITING_INPUT", currentNodeId: node.id, context: asJson(ctx) },
        });
        return { status: "waiting", nodeId: node.id };
      }
      current = nextOf(graph, node.id);
      await db.flowSession.update({ where: { id: session.id }, data: { currentNodeId: current } });
      continue;
    }

    if (d.kind === "image") {
      await sendMessage(db, session.contactId, buildImage(d), { preview: previewOf(d) });
      current = nextOf(graph, node.id);
      await db.flowSession.update({ where: { id: session.id }, data: { currentNodeId: current } });
      continue;
    }

    // Video, audio and PDF share one payload shape and one control flow:
    // send, then walk on. None of them is a branch point.
    if (d.kind === "video" || d.kind === "audio" || d.kind === "file") {
      await sendMessage(db, session.contactId, buildMedia(d), { preview: previewOf(d) });
      current = nextOf(graph, node.id);
      await db.flowSession.update({ where: { id: session.id }, data: { currentNodeId: current } });
      continue;
    }

    if (d.kind === "album") {
      await sendMessage(db, session.contactId, buildAlbum(d), { preview: previewOf(d) });
      current = nextOf(graph, node.id);
      await db.flowSession.update({ where: { id: session.id }, data: { currentNodeId: current } });
      continue;
    }

    if (d.kind === "action") {
      await applyOps(db, session.contactId, d.ops, ctx);
      current = nextOf(graph, node.id);
      await db.flowSession.update({
        where: { id: session.id },
        data: { currentNodeId: current, context: asJson(ctx) },
      });
      continue;
    }

    if (d.kind === "random") {
      const total = d.weights.reduce((a, b) => a + b, 0);
      // Weighted pick. Deterministic per session so a retry can't reroute a
      // contact into the other arm mid-conversation.
      const roll = hashToUnit(session.id + node.id) * total;
      let acc = 0, chosen = 0;
      for (let i = 0; i < d.weights.length; i++) {
        acc += d.weights[i]!;
        if (roll < acc) { chosen = i; break; }
      }
      current = nextOf(graph, node.id, String(chosen));
      await db.flowSession.update({ where: { id: session.id }, data: { currentNodeId: current } });
      continue;
    }

    if (d.kind === "question") {
      await sendText(db, session.contactId, interpolate(d.text, ctx));
      await db.flowSession.update({
        where: { id: session.id },
        data: { status: "WAITING_INPUT", currentNodeId: node.id, context: asJson(ctx) },
      });
      return { status: "waiting", nodeId: node.id };
    }

    if (d.kind === "delay") {
      const resumeAt = resumeAtFor(d);
      await db.flowSession.update({
        where: { id: session.id },
        data: { status: "ACTIVE", currentNodeId: nextOf(graph, node.id), resumeAt, context: asJson(ctx) },
      });
      return { status: "delayed", nodeId: node.id };
    }

    if (d.kind === "tag") {
      const tag = await db.tag.upsert({
        where: { name: d.tagName },
        create: { name: d.tagName },
        update: {},
      });
      if (d.action === "add") {
        await db.contactTag.upsert({
          where: { contactId_tagId: { contactId: session.contactId, tagId: tag.id } },
          create: { contactId: session.contactId, tagId: tag.id },
          update: {},
        });
      } else {
        await db.contactTag
          .delete({ where: { contactId_tagId: { contactId: session.contactId, tagId: tag.id } } })
          .catch(() => {}); // already absent is fine
      }
      current = nextOf(graph, node.id);
      await db.flowSession.update({ where: { id: session.id }, data: { currentNodeId: current } });
      continue;
    }

    if (d.kind === "condition") {
      const pass = await evaluate(db, session.contactId, d, ctx);
      current = nextOf(graph, node.id, pass ? "true" : "false");
      await db.flowSession.update({ where: { id: session.id }, data: { currentNodeId: current } });
      continue;
    }
  }

  // Fell off the end of the graph, or hit the step cap.
  await db.flowSession.update({
    where: { id: session.id },
    data: { status: "COMPLETED", currentNodeId: null, context: asJson(ctx) },
  });
  return { status: "completed" };
}

/** Applies an action node's tag and field operations. */
async function applyOps(
  db: PrismaClient,
  contactId: string,
  ops: Array<Extract<FlowNodeData, { kind: "action" }>["ops"][number]>,
  ctx: Ctx,
): Promise<void> {
  for (const op of ops) {
    if (op.op === "addTag" || op.op === "removeTag") {
      const tag = await db.tag.upsert({
        where: { name: op.tagName },
        create: { name: op.tagName },
        update: {},
      });
      if (op.op === "addTag") {
        await db.contactTag.upsert({
          where: { contactId_tagId: { contactId, tagId: tag.id } },
          create: { contactId, tagId: tag.id },
          update: {},
        });
      } else {
        await db.contactTag
          .delete({ where: { contactId_tagId: { contactId, tagId: tag.id } } })
          .catch(() => {}); // already absent is fine
      }
      continue;
    }

    if (op.op === "setField") {
      ctx[op.key] = op.value;
      await db.contactField.upsert({
        where: { contactId_key: { contactId, key: op.key } },
        create: { contactId, key: op.key, value: op.value },
        update: { value: op.value },
      });
      continue;
    }

    delete ctx[op.key];
    await db.contactField
      .delete({ where: { contactId_key: { contactId, key: op.key } } })
      .catch(() => {});
  }
}

/**
 * Stable 0–1 from a string. Used so a randomizer keeps sending the same
 * contact down the same arm even if the node is re-entered.
 */
function hashToUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function nextOf(graph: FlowGraph, from: string, handle?: string): string | null {
  const edge = graph.edges.find(
    (e) => e.source === from && (handle === undefined || e.sourceHandle === handle),
  );
  return edge?.target ?? null;
}

async function evaluate(
  db: PrismaClient,
  contactId: string,
  d: Extract<FlowNodeData, { kind: "condition" }>,
  ctx: Ctx,
): Promise<boolean> {
  if (d.op === "hasTag") {
    const hit = await db.contactTag.findFirst({
      where: { contactId, tag: { name: d.key } },
    });
    return Boolean(hit);
  }

  const raw = ctx[d.key];
  switch (d.op) {
    case "exists":
      return raw !== undefined && raw !== null && raw !== "";
    case "equals":
      return String(raw ?? "").toLowerCase() === String(d.value ?? "").toLowerCase();
    case "contains":
      return String(raw ?? "").toLowerCase().includes(String(d.value ?? "").toLowerCase());
    case "gt":
      return Number(raw) > Number(d.value);
    case "lt":
      return Number(raw) < Number(d.value);
    default:
      return false;
  }
}

/**
 * Replaces `{{key}}` with context values.
 *
 * Supports a default: `{{nome|amigo}}` renders "amigo" when `nome` is
 * missing. Without a default a missing key still renders as "" — sending
 * a literal "{{nome}}" to a real person is worse than sending nothing.
 *
 * "Missing" means undefined, null, or empty string. An empty stored field is
 * missing for this purpose: a contact whose name we captured as "" should
 * get "amigo", not a hole in the sentence.
 *
 * The default text runs to the closing braces, so it may contain spaces and
 * punctuation ("{{nome|meu amigo}}"), but not `}}` or a further `|`.
 *
 * Lookup order is context first, then ContactField — the session's own
 * answers are fresher than what was stored on the contact in an earlier run.
 * ContactField values are merged into `ctx` by `loadContactFields` before
 * the walk starts, which keeps this function pure and synchronous.
 */
export function interpolate(text: string, ctx: Ctx): string {
  return text.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|([^}|]*))?\}\}/g,
    (_full, key: string, fallback: string | undefined) => {
      const raw = ctx[key];
      const value = raw === undefined || raw === null ? "" : String(raw);
      if (value !== "") return value;
      return fallback === undefined ? "" : fallback.trim();
    },
  );
}

/**
 * Merge a contact's stored fields into a session context.
 *
 * Session context wins on conflict: an answer given in this run is more
 * current than the same key stored during a previous one.
 */
export async function loadContactFields(
  db: PrismaClient,
  contactId: string,
  ctx: Ctx,
): Promise<Ctx> {
  const fields = await db.contactField.findMany({
    where: { contactId },
    select: { key: true, value: true },
  });

  const merged: Ctx = {};
  for (const f of fields) merged[f.key] = f.value;
  return { ...merged, ...ctx };
}

import type { PrismaClient, FlowSession, Prisma } from "@prisma/client";
import { FlowGraph, findEntryNode, type FlowNodeData } from "../lib/flow-schema";
import { coerceFieldValue, compareValues } from "../lib/field-values";
import { validateInput, defaultValidationMessage } from "../lib/input-validation";
import { sendMessage, sendSenderActionToContact } from "./instagram";
import {
  buildMessage,
  buildQuestion,
  buildQuickReply,
  SKIP_HANDLE,
  buildCarousel,
  buildImage,
  buildMedia,
  buildAlbum,
  previewOf,
  resumeAtFor,
  parsePostback,
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
/** Go To jumps one inbound message may trigger; two flows pointing at each other stop here. */
const MAX_HOPS = 5;

/** Node kinds that put a message on the wire, and so deserve a typing bubble. */
const SENDS_MESSAGE: ReadonlySet<FlowNodeData["kind"]> = new Set([
  "message",
  "question",
  "quickreply",
  "carousel",
  "image",
  "video",
  "audio",
  "file",
  "album",
]);

/**
 * Reserved session-context key: set once `mark_seen` has been sent for the
 * inbound message this run answers. Lives in `context` so it survives a delay
 * park without a schema change; underscore-prefixed so no question `saveAs`
 * can collide with it.
 */
const SEEN_KEY = "_markSeenSent";

/** Reserved: invalid-answer counts per question node, `{ [nodeId]: n }`. */
const ATTEMPTS_KEY = "_attempts";
/** Reserved: randomizer arm chosen per node, `{ [nodeId]: handle }`. */
const AB_KEY = "_ab";
const DEFAULT_MAX_ATTEMPTS = 3;

export type StepResult = { status: "waiting" | "completed" | "delayed"; nodeId?: string };

/**
 * `hops` counts Go To Flow jumps already taken while answering this message.
 * `takeover` is set by a Go To Flow: a session already running in the target
 * flow is abandoned rather than blocking the jump — the author said "go
 * there", and a stale session from last week must not veto that.
 */
export async function startFlow(
  db: PrismaClient,
  flowId: string,
  contactId: string,
  opts: { hops?: number; takeover?: boolean } = {},
): Promise<StepResult | null> {
  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow || !flow.enabled) return null;

  const graph = FlowGraph.parse(flow.graph);
  const entry = findEntryNode(graph);
  if (!entry) return null;

  // An opted-out contact starts nothing, whatever the entry point — keyword,
  // comment, story, ref link or menu tap. This is the one place every path
  // goes through, so it is the one place the rule lives.
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { subscribed: true },
  });
  if (!contact?.subscribed) return null;

  // If this contact is already mid-flow here, don't start a second run.
  const existing = await db.flowSession.findFirst({
    where: { contactId, flowId, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
  });
  if (existing) {
    if (!opts.takeover) return { status: "waiting", nodeId: existing.currentNodeId ?? undefined };
    await db.flowSession.updateMany({
      where: { contactId, flowId, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
      data: { status: "ABANDONED" },
    });
  }

  const session = await db.flowSession.create({
    data: { flowId, contactId, currentNodeId: entry, status: "ACTIVE", context: {} },
  });

  return advance(db, session, graph, { hops: opts.hops });
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

  // A delay waiting on the contact: the message is the wake-up, not an answer.
  const delayExit = delayReplyExit(graph, session);
  if (delayExit !== undefined) {
    session = await db.flowSession.update({
      where: { id: session.id },
      data: { status: "ACTIVE", currentNodeId: delayExit, resumeAt: null },
    });
    return advance(db, session, graph, { inbound: true });
  }

  const node = graph.nodes.find((n) => n.id === session.currentNodeId);
  if (node?.data.kind === "question") {
    const q = node.data;
    const ctx: Ctx = { ...(session.context as Ctx) };
    const checked = validateInput(q.inputType, input, q.options);

    if (!checked.ok) {
      const attempts = (ctx[ATTEMPTS_KEY] as Record<string, number> | undefined) ?? {};
      const n = (attempts[node.id] ?? 0) + 1;
      ctx[ATTEMPTS_KEY] = { ...attempts, [node.id]: n };
      const exhausted = n >= (q.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

      if (q.onInvalid === "branch" || exhausted) {
        // Leave by the "invalid" handle; an unwired one falls back to the
        // default path, so a flow never strands a person over a typo.
        const next = nextOf(graph, node.id, "invalid") ?? nextOf(graph, node.id);
        session = await db.flowSession.update({
          where: { id: session.id },
          data: { context: asJson(ctx), status: "ACTIVE", currentNodeId: next },
        });
        return advance(db, session, graph, { inbound: true });
      }

      // Re-ask: the validation message stands in for the question text.
      await sendSenderActionToContact(db, session.contactId, "mark_seen");
      const text = interpolate(q.validationMessage || defaultValidationMessage(q.inputType), ctx);
      await sendMessage(db, session.contactId, buildQuestion(node.id, { ...q, text }), {
        preview: text,
      });
      await db.flowSession.update({
        where: { id: session.id },
        data: { context: asJson(ctx), status: "WAITING_INPUT", currentNodeId: node.id },
      });
      return { status: "waiting", nodeId: node.id };
    }

    session = await storeAnswer(db, session, graph, node.id, q.saveAs, checked.value, ctx);
  }

  return advance(db, session, graph, { inbound: true });
}

/** Write a validated answer to the session and the contact, and step past the question. */
async function storeAnswer(
  db: PrismaClient,
  session: FlowSession,
  graph: FlowGraph,
  nodeId: string,
  saveAs: string,
  value: string,
  ctx: Ctx,
): Promise<FlowSession> {
  ctx[saveAs] = value;
  await db.contactField.upsert({
    where: { contactId_key: { contactId: session.contactId, key: saveAs } },
    create: { contactId: session.contactId, key: saveAs, value },
    update: { value },
  });
  return db.flowSession.update({
    where: { id: session.id },
    data: { context: asJson(ctx), status: "ACTIVE", currentNodeId: nextOf(graph, nodeId) },
  });
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

  // A question's chips: "Pular" stores nothing and walks on; an option chip
  // is the answer, validated like a typed one.
  if (node.data.kind === "question") {
    if (parsed.handle === SKIP_HANDLE && node.data.allowSkip) {
      const updated = await db.flowSession.update({
        where: { id: session.id },
        data: { status: "ACTIVE", context: asJson(ctx), currentNodeId: nextOf(graph, node.id) },
      });
      return advance(db, updated, graph, { inbound: true });
    }
    if (parsed.handle.startsWith("opt:")) {
      return resumeWithInput(db, session, parsed.handle.slice(4));
    }
    return null;
  }

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

  return advance(db, updated, graph, { inbound: true });
}

/**
 * Continue a session parked on a delay node once its `resumeAt` is due.
 *
 * No new inbound message is involved, so an earlier read receipt still
 * stands. This is the worker's entry point — `startFlow` refuses to touch an
 * existing ACTIVE session on purpose (a keyword typed mid-delay must not
 * skip the wait), so it cannot be used to resume one.
 */
export async function resumeDelayed(db: PrismaClient, session: FlowSession): Promise<StepResult> {
  const flow = await db.flow.findUniqueOrThrow({ where: { id: session.flowId } });
  return advance(db, session, FlowGraph.parse(flow.graph), { timer: true });
}

/**
 * Where a delay node parked on itself continues when the contact writes.
 *
 * Returns null when the session is not parked on such a delay.
 */
function delayReplyExit(graph: FlowGraph, session: FlowSession): string | null | undefined {
  const node = graph.nodes.find((n) => n.id === session.currentNodeId);
  if (node?.data.kind !== "delay") return undefined;
  const d = node.data;
  if (d.mode === "untilReply") return nextOf(graph, node.id);
  if ((d.mode ?? "fixed") === "fixed" && d.cancelOnReply) {
    return nextOf(graph, node.id, "replied") ?? nextOf(graph, node.id);
  }
  return undefined;
}

/**
 * Walk the graph until it blocks (question / delay) or ends.
 *
 * `inbound` marks a run that answers a fresh message from the contact (a
 * reply or a button tap), as opposed to a delay resume.
 */
async function advance(
  db: PrismaClient,
  session: FlowSession,
  graph: FlowGraph,
  opts: { inbound?: boolean; hops?: number; timer?: boolean } = {},
): Promise<StepResult> {
  let current = session.currentNodeId;
  // A delay that parked on itself (waiting on the contact, or a cancellable
  // wait) and is now woken by the worker: leave by its timeout path.
  const wokenOn = opts.timer ? current : null;
  // Stored contact fields are readable by {{name}} alongside session answers,
  // so a flow can greet by a name captured weeks ago in a different flow.
  // Session context wins on conflict — see loadContactFields.
  const ctx: Ctx = await loadContactFields(db, session.contactId, { ...(session.context as Ctx) });

  // Read receipt: once per inbound message, sent only when a node is about
  // to reply. Marking every inbound DM as seen (the old webhook behaviour)
  // hid unhandled messages from the account owner in the Instagram app.
  //
  // The receipt is remembered in the session context so a run resumed after
  // a delay does not send it again — but a new inbound message is not
  // covered by an earlier receipt, so an inbound run starts clean.
  if (opts.inbound) delete ctx[SEEN_KEY];
  let markedSeen = ctx[SEEN_KEY] === true;

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
      if (!markedSeen) {
        await sendSenderActionToContact(db, session.contactId, "mark_seen");
        markedSeen = true;
        ctx[SEEN_KEY] = true;
      }
      await sendSenderActionToContact(db, session.contactId, "typing_on");
    }

    if (d.kind === "end") {
      await db.flowSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", currentNodeId: null, context: asJson(ctx) },
      });
      return { status: "completed" };
    }

    if (d.kind === "goal") {
      // Best-effort: a conversion that fails to record must not stop the
      // conversation that produced it.
      await db.flowGoalHit
        .create({
          data: {
            sessionId: session.id,
            flowId: session.flowId,
            nodeId: node.id,
            contactId: session.contactId,
          },
        })
        .catch((err) => console.warn("[runner] goal hit not recorded:", err));
      current = nextOf(graph, node.id);
      await db.flowSession.update({
        where: { id: session.id },
        data: { currentNodeId: current, context: asJson(ctx) },
      });
      continue;
    }

    if (d.kind === "goto") {
      if ("nodeId" in d.target) {
        // Same flow: just move. MAX_STEPS still bounds a loop built from gotos.
        const to = d.target.nodeId;
        current = graph.nodes.some((n) => n.id === to) ? to : null;
        await db.flowSession.update({
          where: { id: session.id },
          data: { currentNodeId: current, context: asJson(ctx) },
        });
        continue;
      }

      // Another flow: this session is done, the other one starts fresh. The
      // hop cap stops two flows that point at each other; on overflow the
      // contact is left where they are rather than spun forever.
      await db.flowSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", currentNodeId: null, context: asJson(ctx) },
      });
      const hops = (opts.hops ?? 0) + 1;
      if (hops > MAX_HOPS) {
        console.warn(`[runner] goto hop limit reached at ${session.flowId}/${node.id}`);
        return { status: "completed" };
      }
      const result = await startFlow(db, d.target.flowId, session.contactId, {
        hops,
        takeover: true,
      });
      return result ?? { status: "completed" };
    }

    if (d.kind === "message") {
      const withText = { ...d, text: interpolate(d.text, ctx) };
      await sendMessage(db, session.contactId, buildMessage(node.id, withText), {
        preview: withText.text,
      });

      // Buttons make this a branch point — unless a "Próximo Passo" edge
      // exists, which is the path for someone who never taps.
      const hasNext = nextOf(graph, node.id) !== null;
      if (d.buttons?.some((b) => b.type === "postback") && !hasNext) {
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
      let acc = 0,
        chosen = 0;
      for (let i = 0; i < d.weights.length; i++) {
        acc += d.weights[i]!;
        if (roll < acc) {
          chosen = i;
          break;
        }
      }
      const handle = String(chosen);
      // Remember the arm on the session and in its own table, so abStats can
      // join arms to goals without parsing every session's context.
      ctx[AB_KEY] = {
        ...((ctx[AB_KEY] as Record<string, string> | undefined) ?? {}),
        [node.id]: handle,
      };
      await db.abAssignment
        .create({
          data: { sessionId: session.id, flowId: session.flowId, nodeId: node.id, handle },
        })
        .catch((err) => console.warn("[runner] A/B assignment not recorded:", err));
      current = nextOf(graph, node.id, handle);
      await db.flowSession.update({
        where: { id: session.id },
        data: { currentNodeId: current, context: asJson(ctx) },
      });
      continue;
    }

    if (d.kind === "question") {
      const withText = { ...d, text: interpolate(d.text, ctx) };
      await sendMessage(db, session.contactId, buildQuestion(node.id, withText), {
        preview: withText.text,
      });
      await db.flowSession.update({
        where: { id: session.id },
        data: { status: "WAITING_INPUT", currentNodeId: node.id, context: asJson(ctx) },
      });
      return { status: "waiting", nodeId: node.id };
    }

    if (d.kind === "delay") {
      const mode = d.mode ?? "fixed";

      if (wokenOn === node.id && step === 0) {
        const handle = mode === "untilReply" ? "timeout" : undefined;
        current = (handle && nextOf(graph, node.id, handle)) || nextOf(graph, node.id);
        await db.flowSession.update({
          where: { id: session.id },
          data: { status: "ACTIVE", currentNodeId: current, context: asJson(ctx) },
        });
        continue;
      }

      const resumeAt = resumeAtFor(d);

      if (mode === "untilReply" || (mode === "fixed" && d.cancelOnReply)) {
        // Park on this node, so the next message from the contact is routed
        // here (WAITING_INPUT) and the worker can still fire the timeout.
        await db.flowSession.update({
          where: { id: session.id },
          data: {
            status: "WAITING_INPUT",
            currentNodeId: node.id,
            resumeAt: mode === "untilReply" && !d.timeoutSeconds ? null : resumeAt,
            context: asJson(ctx),
          },
        });
        return { status: "delayed", nodeId: node.id };
      }

      if (mode === "untilDate" && resumeAt.getTime() <= Date.now()) {
        current = nextOf(graph, node.id);
        await db.flowSession.update({
          where: { id: session.id },
          data: { currentNodeId: current, context: asJson(ctx) },
        });
        continue;
      }

      await db.flowSession.update({
        where: { id: session.id },
        data: {
          status: "ACTIVE",
          currentNodeId: nextOf(graph, node.id),
          resumeAt,
          context: asJson(ctx),
        },
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
      // Stored in canonical form for the declared type, so a later condition
      // compares "1500" with "1499" as numbers — see lib/field-values.ts.
      const value = coerceFieldValue(op.value, op.valueType);
      ctx[op.key] = value;
      await db.contactField.upsert({
        where: { contactId_key: { contactId, key: op.key } },
        create: { contactId, key: op.key, value },
        update: { value },
      });
      continue;
    }

    if (op.op === "unsubscribe" || op.op === "resubscribe") {
      // The running flow continues: the author decides what, if anything, is
      // said after this. Only future broadcasts and flow starts are affected.
      await db.contact.update({
        where: { id: contactId },
        data: { subscribed: op.op === "resubscribe" },
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

/**
 * Follow an edge out of a node.
 *
 * With no handle this takes the default "next" port — the path for a contact
 * who ignored the buttons. A node may legitimately have both: three buttons
 * AND a next step, and which one runs depends on what the person did.
 */
function nextOf(graph: FlowGraph, from: string, handle?: string): string | null {
  if (handle !== undefined) {
    return graph.edges.find((e) => e.source === from && e.sourceHandle === handle)?.target ?? null;
  }
  const edge =
    graph.edges.find((e) => e.source === from && e.sourceHandle === "next") ??
    graph.edges.find((e) => e.source === from && !e.sourceHandle);
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
      return String(raw ?? "")
        .toLowerCase()
        .includes(String(d.value ?? "").toLowerCase());
    case "gt":
    case "lt":
    case "before":
    case "after":
      return compareValues(d.op, raw, d.value);
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

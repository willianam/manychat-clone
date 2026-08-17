import type { PrismaClient, FlowSession, Prisma } from "@prisma/client";
import { FlowGraph, findEntryNode, type FlowNodeData } from "../lib/flow-schema";
import { sendText } from "./instagram";

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

/** Walk the graph until it blocks (question / delay) or ends. */
async function advance(
  db: PrismaClient,
  session: FlowSession,
  graph: FlowGraph,
): Promise<StepResult> {
  let current = session.currentNodeId;
  const ctx: Ctx = { ...(session.context as Ctx) };

  for (let step = 0; step < MAX_STEPS; step++) {
    if (!current) break;
    const node = graph.nodes.find((n) => n.id === current);
    if (!node) break;

    const d: FlowNodeData = node.data;

    if (d.kind === "end") {
      await db.flowSession.update({
        where: { id: session.id },
        data: { status: "COMPLETED", currentNodeId: null, context: asJson(ctx) },
      });
      return { status: "completed" };
    }

    if (d.kind === "message") {
      await sendText(db, session.contactId, interpolate(d.text, ctx));
      current = nextOf(graph, node.id);
      await db.flowSession.update({
        where: { id: session.id },
        data: { currentNodeId: current, context: asJson(ctx) },
      });
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
      const resumeAt = new Date(Date.now() + d.seconds * 1000);
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

/** Replaces {{key}} with context values; unknown keys become "". */
function interpolate(text: string, ctx: Ctx): string {
  return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, k) =>
    String(ctx[k] ?? ""),
  );
}

import type { PrismaClient } from "@prisma/client";
import { FlowGraph } from "../lib/flow-schema";
import { postbackPayload } from "./message-payload";

/**
 * Per-node delivery stats, shown on the canvas the way ManyChat does.
 *
 * Everything here is derived from rows we already write — Message for sends,
 * WebhookEvent for taps — so nothing new has to be recorded at send time.
 */

export type NodeStats = {
  sent: number;
  delivered: number;
  failed: number;
  /** Percent, or null when nothing was sent yet. */
  deliveredPct: number | null;
  clickedPct: number | null;
  /** Taps per button/option handle, for the per-button CTR. */
  byHandle: Record<string, number>;
};

export type FlowStats = Record<string, NodeStats>;

/**
 * Message rows don't carry a node id, so sends are matched back to nodes by
 * their payload. That is exact for interactive nodes (the postback payload
 * embeds the node id) and text-matched for plain messages.
 *
 * The alternative — a nodeId column on Message — is cleaner but would only
 * report on conversations that ran *after* the migration. This reads history.
 */
export async function flowStats(db: PrismaClient, flowId: string): Promise<FlowStats> {
  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow) return {};

  const graph = FlowGraph.safeParse(flow.graph);
  if (!graph.success) return {};

  const sessions = await db.flowSession.findMany({
    where: { flowId },
    select: { contactId: true },
  });
  if (sessions.length === 0) return {};

  const contactIds = [...new Set(sessions.map((s) => s.contactId))];

  const messages = await db.message.findMany({
    where: { contactId: { in: contactIds }, direction: "OUTBOUND" },
    select: { text: true, status: true, payload: true },
  });

  const taps = await db.webhookEvent.findMany({
    where: { kind: "postback" },
    select: { raw: true },
  });

  // handle → tap count, keyed by the full "<nodeId>:<handle>" payload.
  const tapsByPayload = new Map<string, number>();
  for (const t of taps) {
    const raw = t.raw as { postback?: { payload?: string }; message?: { quick_reply?: { payload?: string } } };
    const p = raw?.postback?.payload ?? raw?.message?.quick_reply?.payload;
    if (p) tapsByPayload.set(p, (tapsByPayload.get(p) ?? 0) + 1);
  }

  const stats: FlowStats = {};

  for (const node of graph.data.nodes) {
    const d = node.data;
    const text =
      d.kind === "message" || d.kind === "question" || d.kind === "quickreply" ? d.text : null;

    const mine = messages.filter((m) => {
      if (text && m.text === text) return true;
      // Interactive payloads name the node directly.
      const raw = JSON.stringify(m.payload ?? "");
      return raw.includes(`"${node.id}:`);
    });

    const sent = mine.length;
    const failed = mine.filter((m) => m.status === "FAILED").length;
    const delivered = mine.filter((m) => m.status !== "FAILED" && m.status !== "PENDING").length;

    const byHandle: Record<string, number> = {};
    let clicks = 0;
    const handles =
      d.kind === "quickreply"
        ? d.options.map((o) => o.id)
        : d.kind === "message"
          ? (d.buttons ?? []).filter((b) => b.type === "postback").map((b) => b.id)
          : d.kind === "carousel"
            ? d.cards.flatMap((c) => (c.buttons ?? []).filter((b) => b.type === "postback").map((b) => b.id))
            : [];

    for (const h of handles) {
      const n = tapsByPayload.get(postbackPayload(node.id, h)) ?? 0;
      byHandle[h] = n;
      clicks += n;
    }

    stats[node.id] = {
      sent,
      delivered,
      failed,
      deliveredPct: sent ? Math.round((delivered / sent) * 1000) / 10 : null,
      clickedPct: sent && handles.length ? Math.round((clicks / sent) * 1000) / 10 : null,
      byHandle,
    };
  }

  return stats;
}

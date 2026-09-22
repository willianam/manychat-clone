import { Prisma, type PrismaClient } from "@prisma/client";
import { FlowGraph } from "../lib/flow-schema";
import { postbackPayload } from "./message-payload";

/**
 * Per-node delivery stats, shown on the canvas the way ManyChat does.
 *
 * Sends are attributed by `Message.payload.meta.nodeId`, written by
 * `sendMessage` for every message a flow node sends. Rows from before that
 * existed have no meta and are matched back to nodes the old way — by text,
 * or by the node id embedded in interactive payloads. The two populations
 * are disjoint (a row either has meta or it does not), so they add up
 * without double counting.
 *
 * Everything that can be aggregated in Postgres is: the tagged rows come
 * back as (nodeId, status, count), the taps as (payload, count). Only the
 * legacy rows are read one by one, and those are bounded by `limit` and
 * the period.
 */

export type NodeStats = {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  /** Percent, or null when nothing was sent yet. */
  deliveredPct: number | null;
  readPct: number | null;
  clickedPct: number | null;
  /** Taps per button/option handle, for the per-button CTR. */
  byHandle: Record<string, number>;
};

export type FlowStats = Record<string, NodeStats>;

export type FlowStatsOptions = {
  /** Inclusive lower bound on the send / tap time. */
  from?: Date;
  /** Inclusive upper bound on the send / tap time. */
  to?: Date;
  /** Cap on legacy (untagged) rows read into memory. */
  limit?: number;
};

export const DEFAULT_LEGACY_LIMIT = 5000;

type StatusCount = { nodeId: string | null; status: string; n: number };
type LegacyRow = { text: string | null; status: string; payload: unknown };
type TapCount = { payload: string | null; n: number };

export async function flowStats(
  db: PrismaClient,
  flowId: string,
  opts: FlowStatsOptions = {},
): Promise<FlowStats> {
  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow) return {};

  const graph = FlowGraph.safeParse(flow.graph);
  if (!graph.success) return {};

  const limit = opts.limit ?? DEFAULT_LEGACY_LIMIT;
  const sentRange = rangeSql('"createdAt"', opts);
  const tapRange = rangeSql('"receivedAt"', opts);

  const tagged = await db.$queryRaw<StatusCount[]>(Prisma.sql`
    SELECT payload->'meta'->>'nodeId' AS "nodeId", status::text AS status, COUNT(*)::int AS n
    FROM "Message"
    WHERE direction = 'OUTBOUND'
      AND payload->'meta'->>'flowId' = ${flowId}
      ${sentRange}
    GROUP BY 1, 2`);

  const legacy = await db.$queryRaw<LegacyRow[]>(Prisma.sql`
    SELECT text, status::text AS status, payload
    FROM "Message"
    WHERE direction = 'OUTBOUND'
      AND (payload IS NULL OR payload->'meta' IS NULL)
      AND "contactId" IN (SELECT "contactId" FROM "FlowSession" WHERE "flowId" = ${flowId})
      ${sentRange}
    ORDER BY "createdAt" DESC
    LIMIT ${limit}`);

  const taps = await db.$queryRaw<TapCount[]>(Prisma.sql`
    SELECT COALESCE(raw->'postback'->>'payload', raw->'message'->'quick_reply'->>'payload') AS payload,
           COUNT(*)::int AS n
    FROM "WebhookEvent"
    WHERE kind = 'postback'
      ${tapRange}
    GROUP BY 1`);

  // nodeId → status → count, from the DB aggregate.
  const byNode = new Map<string, Map<string, number>>();
  for (const row of tagged) {
    if (!row.nodeId) continue;
    const m = byNode.get(row.nodeId) ?? new Map<string, number>();
    m.set(row.status, (m.get(row.status) ?? 0) + row.n);
    byNode.set(row.nodeId, m);
  }

  const tapsByPayload = new Map<string, number>();
  for (const t of taps) if (t.payload) tapsByPayload.set(t.payload, t.n);

  // Serialize each legacy payload ONCE, not once per (node × row). The old
  // shape put JSON.stringify inside the inner loop, so a 30-node flow against
  // the 5000-row cap serialized 150k times to answer the same question.
  const legacyRows = legacy.map((m) => ({
    text: m.text,
    status: m.status,
    payloadJson: JSON.stringify(m.payload ?? ""),
  }));

  const stats: FlowStats = {};

  for (const node of graph.data.nodes) {
    const d = node.data;
    const text =
      d.kind === "message" || d.kind === "question" || d.kind === "quickreply" ? d.text : null;

    const counts = new Map(byNode.get(node.id) ?? []);

    // Legacy rows: no meta, so fall back to the old matching.
    const needle = `"${node.id}:`;
    for (const m of legacyRows) {
      const hit = (text && m.text === text) || m.payloadJson.includes(needle);
      if (hit) counts.set(m.status, (counts.get(m.status) ?? 0) + 1);
    }

    let sent = 0;
    for (const n of counts.values()) sent += n;
    const failed = counts.get("FAILED") ?? 0;
    const read = counts.get("READ") ?? 0;
    const delivered = (counts.get("DELIVERED") ?? 0) + read + (counts.get("SENT") ?? 0);

    const byHandle: Record<string, number> = {};
    let clicks = 0;
    const handles =
      d.kind === "quickreply"
        ? d.options.map((o) => o.id)
        : d.kind === "message"
          ? (d.buttons ?? []).filter((b) => b.type === "postback").map((b) => b.id)
          : d.kind === "carousel"
            ? d.cards.flatMap((c) =>
                (c.buttons ?? []).filter((b) => b.type === "postback").map((b) => b.id),
              )
            : [];

    for (const h of handles) {
      const n = tapsByPayload.get(postbackPayload(node.id, h)) ?? 0;
      byHandle[h] = n;
      clicks += n;
    }

    stats[node.id] = {
      sent,
      delivered,
      read,
      failed,
      deliveredPct: pct(delivered, sent),
      readPct: pct(read, sent),
      clickedPct: sent && handles.length ? pct(clicks, sent) : null,
      byHandle,
    };
  }

  return stats;
}

function pct(part: number, whole: number): number | null {
  return whole ? Math.round((part / whole) * 1000) / 10 : null;
}

/** `AND col >= from AND col <= to`, only for the bounds that were given. */
function rangeSql(column: string, opts: FlowStatsOptions): Prisma.Sql {
  const col = Prisma.raw(column);
  return Prisma.sql`
    ${opts.from ? Prisma.sql`AND ${col} >= ${opts.from}` : Prisma.empty}
    ${opts.to ? Prisma.sql`AND ${col} <= ${opts.to}` : Prisma.empty}`;
}

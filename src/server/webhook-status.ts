import type { PrismaClient } from "@prisma/client";
import type { EventKind } from "./webhook-events";

/**
 * What the settings page says about the webhook subscription.
 *
 * Meta does not expose "which fields are subscribed" to the app itself, so
 * the honest answer is indirect: the fields the code expects, and when each
 * kind of event last arrived. A field that never produced an event is
 * either not subscribed or simply quiet; the page says which is plausible.
 */

export type WebhookField = {
  field: string;
  purpose: string;
  /** Event kinds this field produces, as claimed in the webhook route. */
  kinds: EventKind[];
  /** True when the Instagram-login API does not offer this field today. */
  optional?: boolean;
};

export const WEBHOOK_FIELDS: WebhookField[] = [
  {
    field: "messages",
    purpose: "DMs, respostas a story, menções em story e ref links",
    kinds: ["message", "story_reply", "story_mention", "referral"],
  },
  { field: "messaging_postbacks", purpose: "toques em botão e quick reply", kinds: ["postback"] },
  { field: "comments", purpose: "comentário → DM", kinds: ["comment"] },
  { field: "messaging_seen", purpose: "recibo de leitura (lido)", kinds: ["read"] },
  {
    field: "message_deliveries",
    purpose: "recibo de entrega (entregue); não existe na API com login do Instagram",
    kinds: ["delivery"],
    optional: true,
  },
];

export const KIND_LABEL: Record<EventKind, string> = {
  message: "mensagem",
  postback: "botão / quick reply",
  comment: "comentário",
  story_reply: "resposta a story",
  story_mention: "menção em story",
  referral: "ref link",
  read: "leitura",
  delivery: "entrega",
};

export type WebhookStatus = {
  /** Per event kind: when it last arrived and how many ever did. */
  lastByKind: Array<{ kind: EventKind; lastAt: Date; count: number }>;
  received24h: number;
  failed24h: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function webhookStatus(db: PrismaClient, now = new Date()): Promise<WebhookStatus> {
  const since = new Date(now.getTime() - DAY_MS);
  const [grouped, received24h, failed24h] = await Promise.all([
    db.webhookEvent.groupBy({
      by: ["kind"],
      _max: { receivedAt: true },
      _count: { _all: true },
    }),
    db.webhookEvent.count({ where: { receivedAt: { gte: since } } }),
    db.webhookEvent.count({ where: { receivedAt: { gte: since }, error: { not: null } } }),
  ]);

  const lastByKind = grouped
    .filter((g) => g._max.receivedAt !== null)
    .map((g) => ({
      kind: g.kind as EventKind,
      lastAt: g._max.receivedAt as Date,
      count: g._count._all,
    }))
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());

  return { lastByKind, received24h, failed24h };
}

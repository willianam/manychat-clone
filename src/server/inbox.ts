import type { PrismaClient, QuickReplyTemplate } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { windowRemainingMs, HUMAN_AGENT_WINDOW_MS } from "../lib/messaging-window";
import { FlowGraph, type NodeKind } from "../lib/flow-schema";
import { sendHumanAgentMessage, sendMessage, sendText } from "./instagram";
import type { ConversationFilter } from "../lib/inbox-filters";

/**
 * Inbox: the operator's view of conversations.
 *
 * Nothing here is new data — messages, contacts and flow sessions already
 * exist. What the inbox adds is *ordering* (Contact.lastMessageAt), the
 * *read mark* (Contact.lastReadAt) and the *human takeover* switch
 * (Contact.automationPaused). "Unread" is derived, never stored: an INBOUND
 * message newer than lastReadAt.
 */

export { touchLastMessage } from "./last-message";

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------

export type { ConversationFilter } from "../lib/inbox-filters";
export { parseConversationFilter } from "../lib/inbox-filters";

export type ConversationPreview = {
  text: string | null;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  at: Date;
};

export type ConversationRow = {
  id: string;
  name: string | null;
  username: string | null;
  profilePic: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  automationPaused: boolean;
  subscribed: boolean;
  windowOpen: boolean;
  unread: number;
  preview: ConversationPreview | null;
};

export type ConversationPage = { items: ConversationRow[]; nextCursor: string | null };

/** The fields the list needs, plus the newest message as the preview. */
const conversationSelect = {
  id: true,
  name: true,
  username: true,
  profilePic: true,
  lastMessageAt: true,
  lastInboundAt: true,
  lastReadAt: true,
  automationPaused: true,
  subscribed: true,
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { text: true, direction: true, status: true, createdAt: true },
  },
} satisfies Prisma.ContactSelect;

type ConversationRecord = Prisma.ContactGetPayload<{ select: typeof conversationSelect }>;

/**
 * Conversations, newest message first.
 *
 * `cursor` is the ISO `lastMessageAt` of the last row on the previous page.
 * The "unread" filter cannot be expressed as a Prisma where (it compares
 * two columns of the same row), so it loads the newest 200 conversations
 * and filters in memory — a personal inbox never has 200 unread threads,
 * and if it did, the operator has a bigger problem than pagination.
 */
export async function listConversations(
  db: PrismaClient,
  opts: {
    filter?: ConversationFilter;
    q?: string;
    cursor?: string;
    limit?: number;
    now?: Date;
  } = {},
): Promise<ConversationPage> {
  const filter = opts.filter ?? "all";
  const limit = Math.max(1, Math.min(opts.limit ?? 30, 100));
  const now = opts.now ?? new Date();
  const q = opts.q?.trim();

  const where: Prisma.ContactWhereInput = { lastMessageAt: { not: null } };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { username: { contains: q, mode: "insensitive" } },
    ];
  }
  if (filter === "paused") where.automationPaused = true;
  if (filter === "open-window")
    where.lastInboundAt = { gt: new Date(now.getTime() - 24 * 3_600_000) };
  if (filter !== "unread" && opts.cursor) {
    const before = new Date(opts.cursor);
    // Keep `not: null` — assigning only `lt` dropped it, so a cursor page
    // could include contacts that have never exchanged a message.
    if (!Number.isNaN(before.getTime())) where.lastMessageAt = { not: null, lt: before };
  }

  const take = filter === "unread" ? 200 : limit + 1;
  const rows = await db.contact.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take,
    select: conversationSelect,
  });

  const counts = await unreadCounts(db, rows);
  let items = rows.map((r) => toRow(r, counts.get(r.id) ?? 0, now));

  if (filter === "unread") {
    return { items: items.filter((i) => i.unread > 0), nextCursor: null };
  }

  const hasMore = items.length > limit;
  items = items.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last?.lastMessageAt ? last.lastMessageAt.toISOString() : null,
  };
}

function toRow(r: ConversationRecord, unread: number, now: Date): ConversationRow {
  const m = r.messages[0];
  return {
    id: r.id,
    name: r.name,
    username: r.username,
    profilePic: r.profilePic,
    lastMessageAt: r.lastMessageAt,
    lastInboundAt: r.lastInboundAt,
    automationPaused: r.automationPaused,
    subscribed: r.subscribed,
    windowOpen: windowRemainingMs(r.lastInboundAt, now) > 0,
    unread,
    preview: m ? { text: m.text, direction: m.direction, status: m.status, at: m.createdAt } : null,
  };
}

/**
 * INBOUND messages newer than each contact's read mark, in one query: the
 * per-contact watermark becomes one OR branch, grouped back by contact.
 */
async function unreadCounts(
  db: PrismaClient,
  contacts: Array<{ id: string; lastReadAt: Date | null }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (contacts.length === 0) return out;

  const groups = await db.message.groupBy({
    by: ["contactId"],
    where: {
      direction: "INBOUND",
      OR: contacts.map((c) => ({
        contactId: c.id,
        ...(c.lastReadAt ? { createdAt: { gt: c.lastReadAt } } : {}),
      })),
    },
    _count: { _all: true },
  });
  for (const g of groups) out.set(g.contactId, g._count._all);
  return out;
}

/**
 * How many conversations have something unread — the sidebar badge.
 *
 * One aggregate, no rows on the wire. This used to pull EVERY contact that
 * had ever written into memory and then build a groupBy with one OR branch
 * per contact — a WHERE with thousands of disjunctions, on every request,
 * because the root layout is force-dynamic and the inbox refreshes it every
 * 10s. The comparison it needs (a Message against its own contact's read
 * mark) is a join, which is why Prisma could not express it; raw SQL can.
 *
 * A comment-to-DM contact, whose lastInboundAt moved without an inbound
 * Message ever being written, is still excluded: the count is driven by
 * Message rows, not by the watermark.
 */
export async function unreadConversationCount(db: PrismaClient): Promise<number> {
  const rows = await db.$queryRaw<Array<{ n: bigint | number }>>(Prisma.sql`
    SELECT COUNT(DISTINCT m."contactId")::int AS n
    FROM "Message" m
    JOIN "Contact" c ON c.id = m."contactId"
    WHERE m.direction = 'INBOUND'
      AND (c."lastReadAt" IS NULL OR m."createdAt" > c."lastReadAt")`);
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export type ThreadMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  text: string | null;
  status: string;
  error: string | null;
  payload: unknown;
  createdAt: Date;
};

export type ActiveFlow = {
  sessionId: string;
  flowId: string;
  flowName: string;
  status: "ACTIVE" | "WAITING_INPUT";
  nodeId: string | null;
  nodeLabel: string | null;
};

export type ThreadContact = {
  id: string;
  igScopedId: string;
  name: string | null;
  username: string | null;
  profilePic: string | null;
  source: string | null;
  subscribed: boolean;
  automationPaused: boolean;
  lastInboundAt: Date | null;
  lastReadAt: Date | null;
  createdAt: Date;
  tags: Array<{ id: string; name: string; color: string }>;
  fields: Array<{ key: string; value: string; label: string }>;
  notes: Array<{ id: string; text: string; createdAt: Date }>;
};

export type MessagingWindow = {
  /** Standard 24h window still open. */
  open: boolean;
  remainingMs: number;
  /** The 7-day HUMAN_AGENT window still open (implies nothing about `open`). */
  humanAgentOpen: boolean;
};

export type Thread = {
  contact: ThreadContact;
  messages: ThreadMessage[];
  /** `createdAt` of the oldest message on this page, for "load older". */
  nextBefore: Date | null;
  activeFlow: ActiveFlow | null;
  window: MessagingWindow;
};

/** One conversation. Null when the contact does not exist. */
export async function thread(
  db: PrismaClient,
  contactId: string,
  opts: { before?: Date; limit?: number; now?: Date } = {},
): Promise<Thread | null> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const now = opts.now ?? new Date();

  const contact = await db.contact.findUnique({
    where: { id: contactId },
    include: {
      tags: { include: { tag: true } },
      fields: { orderBy: { key: "asc" } },
      notes: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!contact) return null;

  const [rows, session, customFields] = await Promise.all([
    db.message.findMany({
      where: { contactId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: {
        id: true,
        direction: true,
        text: true,
        status: true,
        error: true,
        payload: true,
        createdAt: true,
      },
    }),
    db.flowSession.findFirst({
      where: { contactId, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
      orderBy: { updatedAt: "desc" },
      include: { flow: { select: { name: true, graph: true } } },
    }),
    db.customField.findMany({ select: { key: true, label: true } }),
  ]);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const labels = new Map(customFields.map((f) => [f.key, f.label]));

  return {
    contact: {
      id: contact.id,
      igScopedId: contact.igScopedId,
      name: contact.name,
      username: contact.username,
      profilePic: contact.profilePic,
      source: contact.source,
      subscribed: contact.subscribed,
      automationPaused: contact.automationPaused,
      lastInboundAt: contact.lastInboundAt,
      lastReadAt: contact.lastReadAt,
      createdAt: contact.createdAt,
      tags: contact.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
      fields: contact.fields.map((f) => ({
        key: f.key,
        value: f.value,
        label: labels.get(f.key) ?? f.key,
      })),
      notes: contact.notes.map((n) => ({ id: n.id, text: n.text, createdAt: n.createdAt })),
    },
    messages: page,
    nextBefore: hasMore && page[0] ? page[0].createdAt : null,
    activeFlow: session
      ? {
          sessionId: session.id,
          flowId: session.flowId,
          flowName: session.flow.name,
          status: session.status as "ACTIVE" | "WAITING_INPUT",
          nodeId: session.currentNodeId,
          nodeLabel: session.currentNodeId
            ? nodeLabelOf(session.flow.graph, session.currentNodeId)
            : null,
        }
      : null,
    window: windowOf(contact.lastInboundAt, now),
  };
}

export function windowOf(lastInboundAt: Date | null, now: Date = new Date()): MessagingWindow {
  const remainingMs = windowRemainingMs(lastInboundAt, now);
  const humanAgentOpen =
    !!lastInboundAt && now.getTime() - lastInboundAt.getTime() <= HUMAN_AGENT_WINDOW_MS;
  return { open: remainingMs > 0, remainingMs, humanAgentOpen };
}

const NODE_KIND_LABEL: Record<NodeKind, string> = {
  message: "mensagem",
  question: "pergunta",
  quickreply: "respostas rápidas",
  carousel: "carrossel",
  image: "imagem",
  video: "vídeo",
  audio: "áudio",
  file: "arquivo",
  album: "álbum",
  condition: "condição",
  delay: "espera",
  action: "ação",
  random: "aleatório",
  tag: "etiqueta",
  goto: "ir para",
  goal: "objetivo",
  request: "requisição",
  end: "fim",
};

/**
 * A human-readable name for the node a session sits on: the kind, plus the
 * first words of its text when it has any. Tolerates an invalid graph (the
 * owner may be mid-edit) by falling back to the raw node id.
 */
export function nodeLabelOf(graph: unknown, nodeId: string): string {
  const parsed = FlowGraph.safeParse(graph);
  if (!parsed.success) return nodeId;
  const node = parsed.data.nodes.find((n) => n.id === nodeId);
  if (!node) return nodeId;
  const kind = NODE_KIND_LABEL[node.type] ?? node.type;
  const text = (node.data as { text?: unknown }).text;
  if (typeof text === "string" && text.trim()) {
    const short = text.trim().replace(/\s+/g, " ");
    return `${kind}: “${short.length > 40 ? `${short.slice(0, 40)}…` : short}”`;
  }
  return kind;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** The operator opened (or replied in) this conversation: nothing is unread. */
export async function markRead(db: PrismaClient, contactId: string, at: Date = new Date()) {
  await db.contact.update({ where: { id: contactId }, data: { lastReadAt: at } });
}

/**
 * Human takeover. While paused, trigger-dispatch starts and advances no
 * flow for this contact (global keywords still work). Open sessions are
 * left as they are, so "retomar" picks up a waiting question where it was.
 */
export async function setAutomationPaused(db: PrismaClient, contactId: string, paused: boolean) {
  await db.contact.update({ where: { id: contactId }, data: { automationPaused: paused } });
}

export type ReplyInput = {
  text?: string;
  /** A rich payload in the wire shape (attachment etc.), with a preview line. */
  content?: Record<string, unknown>;
  preview?: string;
  /**
   * The operator marked "atendimento humano". Outside the 24h window the
   * send goes under HUMAN_AGENT (7 days). Never set by automation.
   */
  humanAgent?: boolean;
};

/**
 * Send a reply typed in the inbox.
 *
 * Inside the 24h window it is a standard send. Outside it, only a human
 * marking the reply as human support may send — under the HUMAN_AGENT tag,
 * and only up to 7 days. Errors are in the operator's language: they show
 * up as a toast, not in a log.
 */
export async function reply(db: PrismaClient, contactId: string, input: ReplyInput) {
  const text = input.text?.trim() ?? "";
  if (!text && !input.content) throw new Error("Escreva uma mensagem antes de enviar.");

  const contact = await db.contact.findUniqueOrThrow({
    where: { id: contactId },
    select: { lastInboundAt: true },
  });
  const w = windowOf(contact.lastInboundAt);

  if (!w.open) {
    if (!contact.lastInboundAt) {
      throw new Error("Este contato nunca escreveu; o Instagram não permite iniciar a conversa.");
    }
    if (!input.humanAgent) {
      throw new Error(
        "A janela de 24h fechou. Marque “atendimento humano” para enviar com a tag HUMAN_AGENT (até 7 dias).",
      );
    }
    if (!w.humanAgentOpen) {
      throw new Error(
        "Passaram mais de 7 dias desde a última mensagem; nem o atendimento humano alcança.",
      );
    }
  }

  const tag = !w.open && input.humanAgent ? ("HUMAN_AGENT" as const) : undefined;

  if (input.content) {
    await sendMessage(db, contactId, input.content, { tag, preview: input.preview ?? text });
  } else if (tag) {
    await sendHumanAgentMessage(contactId, text, db);
  } else {
    await sendText(db, contactId, text);
  }

  await markRead(db, contactId);
}

// ---------------------------------------------------------------------------
// Quick replies
// ---------------------------------------------------------------------------

export function listQuickReplies(db: PrismaClient): Promise<QuickReplyTemplate[]> {
  return db.quickReplyTemplate.findMany({ orderBy: { shortcut: "asc" } });
}

/** "Preço à vista" → "preco-a-vista": what the operator types after "/". */
export function normalizeShortcut(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export async function createQuickReply(
  db: PrismaClient,
  input: { title: string; text: string; shortcut?: string },
): Promise<QuickReplyTemplate> {
  const title = input.title.trim();
  const text = input.text.trim();
  if (!title) throw new Error("Dê um título à resposta rápida.");
  if (!text) throw new Error("A resposta rápida precisa de um texto.");
  const shortcut = normalizeShortcut(input.shortcut?.trim() || title);
  if (!shortcut) throw new Error("O atalho precisa ter letras ou números.");

  const clash = await db.quickReplyTemplate.findUnique({ where: { shortcut } });
  if (clash) throw new Error(`Já existe uma resposta rápida com o atalho /${shortcut}.`);

  return db.quickReplyTemplate.create({ data: { title, text: text.slice(0, 1000), shortcut } });
}

export async function deleteQuickReply(db: PrismaClient, id: string): Promise<void> {
  await db.quickReplyTemplate.delete({ where: { id } });
}

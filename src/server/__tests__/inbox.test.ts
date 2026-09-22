import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * The inbox service against an in-memory Prisma: unread is derived from the
 * read mark, filters narrow the list, the thread names the node a session
 * sits on, and a reply picks the tag from the window.
 */

vi.mock("../instagram", () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  sendHumanAgentMessage: vi.fn().mockResolvedValue(undefined),
}));

import { sendHumanAgentMessage, sendMessage, sendText } from "../instagram";
import {
  createQuickReply,
  listConversations,
  markRead,
  nodeLabelOf,
  normalizeShortcut,
  reply,
  setAutomationPaused,
  thread,
  unreadConversationCount,
  windowOf,
} from "../inbox";

const NOW = new Date("2026-08-27T12:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

type Contact = {
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
  lastMessageAt: Date | null;
  createdAt: Date;
};
type Message = {
  id: string;
  contactId: string;
  direction: "INBOUND" | "OUTBOUND";
  text: string | null;
  status: string;
  error: string | null;
  payload: unknown;
  createdAt: Date;
};

function contact(id: string, patch: Partial<Contact> = {}): Contact {
  return {
    id,
    igScopedId: `ig-${id}`,
    name: `Nome ${id}`,
    username: `user_${id}`,
    profilePic: null,
    source: "dm",
    subscribed: true,
    automationPaused: false,
    lastInboundAt: h(1),
    lastReadAt: null,
    lastMessageAt: h(1),
    createdAt: h(100),
    ...patch,
  };
}

let seq = 0;
function msg(contactId: string, direction: Message["direction"], at: Date, text = "…"): Message {
  seq++;
  return {
    id: `m${seq}`,
    contactId,
    direction,
    text,
    status: direction === "INBOUND" ? "DELIVERED" : "SENT",
    error: null,
    payload: null,
    createdAt: at,
  };
}

/** Just enough of Prisma for inbox.ts: the where-shapes it actually builds. */
function fakeDb(state: {
  contacts: Contact[];
  messages: Message[];
  sessions?: Array<{
    id: string;
    contactId: string;
    flowId: string;
    status: string;
    currentNodeId: string | null;
    updatedAt: Date;
    flow: { name: string; graph: unknown };
  }>;
  quickReplies?: Array<{ id: string; title: string; text: string; shortcut: string }>;
}) {
  const sessions = state.sessions ?? [];
  const quick = state.quickReplies ?? [];

  const matchesContact = (c: Contact, where: Record<string, unknown>): boolean => {
    if (where.lastMessageAt) {
      const f = where.lastMessageAt as { not?: null; lt?: Date };
      if ("not" in f && c.lastMessageAt === null) return false;
      if (f.lt && (!c.lastMessageAt || c.lastMessageAt >= f.lt)) return false;
    }
    if (where.lastInboundAt) {
      const f = where.lastInboundAt as { not?: null; gt?: Date };
      if ("not" in f && c.lastInboundAt === null) return false;
      if (f.gt && (!c.lastInboundAt || c.lastInboundAt <= f.gt)) return false;
    }
    if (where.automationPaused !== undefined && c.automationPaused !== where.automationPaused) {
      return false;
    }
    if (where.OR) {
      const or = where.OR as Array<{
        name?: { contains: string };
        username?: { contains: string };
      }>;
      const hit = or.some((b) => {
        if (b.name) return (c.name ?? "").toLowerCase().includes(b.name.contains.toLowerCase());
        if (b.username) {
          return (c.username ?? "").toLowerCase().includes(b.username.contains.toLowerCase());
        }
        return false;
      });
      if (!hit) return false;
    }
    return true;
  };

  const db = {
    /**
     * unreadConversationCount is one raw aggregate (a Message joined to its
     * own contact's read mark — a comparison Prisma cannot express). The
     * fake reproduces that predicate in JS so the badge's semantics stay
     * covered here; the SQL text itself is exercised against Postgres.
     */
    $queryRaw: vi.fn(async () => {
      const unread = new Set<string>();
      for (const m of state.messages) {
        if (m.direction !== "INBOUND") continue;
        const c = state.contacts.find((x) => x.id === m.contactId);
        if (!c) continue;
        if (!c.lastReadAt || m.createdAt > c.lastReadAt) unread.add(m.contactId);
      }
      return [{ n: unread.size }];
    }),
    contact: {
      findMany: vi.fn(
        async ({
          where,
          take,
          orderBy,
        }: {
          where: Record<string, unknown>;
          take?: number;
          orderBy?: unknown;
        }) => {
          let rows = state.contacts.filter((c) => matchesContact(c, where));
          if (orderBy) {
            rows = rows.sort(
              (a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0),
            );
          }
          if (take) rows = rows.slice(0, take);
          return rows.map((c) => ({
            ...c,
            messages: state.messages
              .filter((m) => m.contactId === c.id)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .slice(0, 1),
          }));
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const c = state.contacts.find((x) => x.id === where.id);
        return c ? { ...c, tags: [], fields: [], notes: [] } : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const c = state.contacts.find((x) => x.id === where.id);
        if (!c) throw new Error("not found");
        return { ...c };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Contact> }) => {
        const c = state.contacts.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return { ...c };
      }),
    },
    message: {
      groupBy: vi.fn(
        async ({
          where,
        }: {
          where: { OR: Array<{ contactId: string; createdAt?: { gt: Date } }> };
        }) => {
          const counts = new Map<string, number>();
          for (const m of state.messages) {
            if (m.direction !== "INBOUND") continue;
            const ok = where.OR.some(
              (b) => b.contactId === m.contactId && (!b.createdAt || m.createdAt > b.createdAt.gt),
            );
            if (ok) counts.set(m.contactId, (counts.get(m.contactId) ?? 0) + 1);
          }
          return [...counts].map(([contactId, n]) => ({ contactId, _count: { _all: n } }));
        },
      ),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: { contactId: string; createdAt?: { lt: Date } };
          take: number;
        }) =>
          state.messages
            .filter(
              (m) =>
                m.contactId === where.contactId &&
                (!where.createdAt || m.createdAt < where.createdAt.lt),
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, take),
      ),
    },
    flowSession: {
      findFirst: vi.fn(
        async ({ where }: { where: { contactId: string } }) =>
          sessions.find((s) => s.contactId === where.contactId) ?? null,
      ),
    },
    customField: { findMany: vi.fn().mockResolvedValue([{ key: "cidade", label: "Cidade" }]) },
    quickReplyTemplate: {
      findMany: vi.fn(async () => [...quick]),
      findUnique: vi.fn(
        async ({ where }: { where: { shortcut: string } }) =>
          quick.find((q) => q.shortcut === where.shortcut) ?? null,
      ),
      create: vi.fn(
        async ({ data }: { data: { title: string; text: string; shortcut: string } }) => {
          const row = { id: `q${quick.length + 1}`, ...data };
          quick.push(row);
          return row;
        },
      ),
    },
  } as unknown as PrismaClient;

  return db;
}

beforeEach(() => {
  vi.mocked(sendText).mockClear();
  vi.mocked(sendMessage).mockClear();
  vi.mocked(sendHumanAgentMessage).mockClear();
});

describe("listConversations", () => {
  function scenario() {
    const contacts = [
      // Never read: two inbound after nothing → 2 unread.
      contact("a", { lastMessageAt: h(1), lastInboundAt: h(1) }),
      // Read after the last inbound → 0 unread; paused; window closed (30h).
      contact("b", {
        lastMessageAt: h(2),
        lastInboundAt: h(30),
        lastReadAt: h(2),
        automationPaused: true,
      }),
      // Read, then one more inbound → 1 unread.
      contact("c", { lastMessageAt: h(3), lastInboundAt: h(3), lastReadAt: h(5) }),
      // No message at all: not a conversation.
      contact("d", { lastMessageAt: null, lastInboundAt: null }),
    ];
    const messages = [
      msg("a", "INBOUND", h(1.5), "oi"),
      msg("a", "INBOUND", h(1), "tem?"),
      msg("b", "INBOUND", h(30), "preço"),
      msg("b", "OUTBOUND", h(2), "R$ 10"),
      msg("c", "INBOUND", h(6), "primeira"),
      msg("c", "INBOUND", h(3), "segunda"),
    ];
    return fakeDb({ contacts, messages });
  }

  it("orders by last message, previews the newest one and counts unread after the read mark", async () => {
    const page = await listConversations(scenario(), { now: NOW });
    expect(page.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(page.items.map((i) => i.unread)).toEqual([2, 0, 1]);
    expect(page.items[0]!.preview?.text).toBe("tem?");
    expect(page.items[1]!.preview).toMatchObject({ text: "R$ 10", direction: "OUTBOUND" });
    expect(page.nextCursor).toBeNull();
  });

  it("filters unread, paused and open-window", async () => {
    const unread = await listConversations(scenario(), { filter: "unread", now: NOW });
    expect(unread.items.map((i) => i.id)).toEqual(["a", "c"]);

    const paused = await listConversations(scenario(), { filter: "paused", now: NOW });
    expect(paused.items.map((i) => i.id)).toEqual(["b"]);

    const open = await listConversations(scenario(), { filter: "open-window", now: NOW });
    expect(open.items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(open.items.every((i) => i.windowOpen)).toBe(true);
  });

  it("searches name and username, case-insensitively", async () => {
    const byName = await listConversations(scenario(), { q: "nome B", now: NOW });
    expect(byName.items.map((i) => i.id)).toEqual(["b"]);
    const byUser = await listConversations(scenario(), { q: "USER_C", now: NOW });
    expect(byUser.items.map((i) => i.id)).toEqual(["c"]);
  });

  it("paginates with a lastMessageAt cursor", async () => {
    const first = await listConversations(scenario(), { limit: 2, now: NOW });
    expect(first.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(first.nextCursor).toBe(h(2).toISOString());

    const second = await listConversations(scenario(), {
      limit: 2,
      cursor: first.nextCursor!,
      now: NOW,
    });
    expect(second.items.map((i) => i.id)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("counts conversations with unread for the sidebar badge", async () => {
    expect(await unreadConversationCount(scenario())).toBe(2);
  });

  it("does not count a contact whose lastInboundAt moved without an inbound message", async () => {
    // Comment-to-DM: the private reply opens the window but no Message arrived.
    const db = fakeDb({
      contacts: [contact("x", { lastInboundAt: h(1), lastReadAt: null, lastMessageAt: h(1) })],
      messages: [msg("x", "OUTBOUND", h(1), "Oi! Vi seu comentário")],
    });
    expect(await unreadConversationCount(db)).toBe(0);
  });
});

describe("thread", () => {
  const GRAPH = {
    nodes: [
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: { kind: "question", text: "Qual sua cidade?  Me conta", saveAs: "cidade" },
      },
      { id: "e1", type: "end", position: { x: 0, y: 0 }, data: { kind: "end" } },
    ],
    edges: [{ id: "q1-e1", source: "q1", target: "e1" }],
  };

  it("returns messages oldest-first, the active flow with its node label and the window", async () => {
    const db = fakeDb({
      contacts: [contact("a", { lastInboundAt: h(2) })],
      messages: [
        msg("a", "INBOUND", h(3), "oi"),
        msg("a", "OUTBOUND", h(2.5), "olá"),
        msg("a", "INBOUND", h(2), "tudo bem"),
      ],
      sessions: [
        {
          id: "s1",
          contactId: "a",
          flowId: "f1",
          status: "WAITING_INPUT",
          currentNodeId: "q1",
          updatedAt: h(2),
          flow: { name: "Boas-vindas", graph: GRAPH },
        },
      ],
    });

    const t = await thread(db, "a", { now: NOW });
    expect(t).not.toBeNull();
    expect(t!.messages.map((m) => m.text)).toEqual(["oi", "olá", "tudo bem"]);
    expect(t!.nextBefore).toBeNull();
    expect(t!.activeFlow).toMatchObject({
      flowName: "Boas-vindas",
      status: "WAITING_INPUT",
      nodeId: "q1",
      nodeLabel: "pergunta: “Qual sua cidade? Me conta”",
    });
    expect(t!.window).toEqual({ open: true, remainingMs: 22 * 3_600_000, humanAgentOpen: true });
  });

  it("pages older messages by createdAt", async () => {
    const db = fakeDb({
      contacts: [contact("a")],
      messages: [
        msg("a", "INBOUND", h(5), "1"),
        msg("a", "INBOUND", h(4), "2"),
        msg("a", "INBOUND", h(3), "3"),
      ],
    });
    const first = await thread(db, "a", { limit: 2, now: NOW });
    expect(first!.messages.map((m) => m.text)).toEqual(["2", "3"]);
    expect(first!.nextBefore).toEqual(h(4));
    const older = await thread(db, "a", { limit: 2, before: first!.nextBefore!, now: NOW });
    expect(older!.messages.map((m) => m.text)).toEqual(["1"]);
    expect(older!.nextBefore).toBeNull();
  });

  it("is null for an unknown contact", async () => {
    expect(await thread(fakeDb({ contacts: [], messages: [] }), "zz")).toBeNull();
  });

  it("labels nodes by kind and falls back to the id on an invalid graph", () => {
    expect(nodeLabelOf(GRAPH, "e1")).toBe("fim");
    expect(nodeLabelOf(GRAPH, "nope")).toBe("nope");
    expect(nodeLabelOf({ nodes: [] }, "q1")).toBe("q1");
  });
});

describe("markRead / setAutomationPaused", () => {
  it("write the two flags on the contact", async () => {
    const db = fakeDb({ contacts: [contact("a")], messages: [] });
    await markRead(db, "a", NOW);
    await setAutomationPaused(db, "a", true);
    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { lastReadAt: NOW },
    });
    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { automationPaused: true },
    });
  });
});

describe("reply", () => {
  it("sends a standard message inside the 24h window and marks the thread read", async () => {
    const db = fakeDb({
      contacts: [contact("a", { lastInboundAt: new Date(Date.now() - 3_600_000) })],
      messages: [],
    });
    await reply(db, "a", { text: "  olá  " });
    expect(sendText).toHaveBeenCalledWith(db, "a", "olá");
    expect(sendHumanAgentMessage).not.toHaveBeenCalled();
    expect(db.contact.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { lastReadAt: expect.any(Date) },
    });
  });

  it("refuses outside the window unless the operator marks human support", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3_600_000);
    const db = fakeDb({ contacts: [contact("a", { lastInboundAt: twoDaysAgo })], messages: [] });
    await expect(reply(db, "a", { text: "oi" })).rejects.toThrow(/atendimento humano/);
    expect(sendText).not.toHaveBeenCalled();

    await reply(db, "a", { text: "oi", humanAgent: true });
    expect(sendHumanAgentMessage).toHaveBeenCalledWith("a", "oi", db);
  });

  it("refuses after 7 days even as human support, and for a contact who never wrote", async () => {
    const db = fakeDb({
      contacts: [
        contact("old", { lastInboundAt: new Date(Date.now() - 8 * 24 * 3_600_000) }),
        contact("never", { lastInboundAt: null }),
      ],
      messages: [],
    });
    await expect(reply(db, "old", { text: "oi", humanAgent: true })).rejects.toThrow(/7 dias/);
    await expect(reply(db, "never", { text: "oi", humanAgent: true })).rejects.toThrow(
      /nunca escreveu/,
    );
    expect(sendHumanAgentMessage).not.toHaveBeenCalled();
  });

  it("sends rich content through sendMessage with the tag chosen by the window", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3_600_000);
    const db = fakeDb({ contacts: [contact("a", { lastInboundAt: twoDaysAgo })], messages: [] });
    const content = { attachment: { type: "image", payload: { url: "https://x/y.png" } } };
    await reply(db, "a", { content, preview: "[imagem]", humanAgent: true });
    expect(sendMessage).toHaveBeenCalledWith(db, "a", content, {
      tag: "HUMAN_AGENT",
      preview: "[imagem]",
    });
  });

  it("rejects an empty reply before touching the network", async () => {
    const db = fakeDb({ contacts: [contact("a")], messages: [] });
    await expect(reply(db, "a", { text: "   " })).rejects.toThrow(/Escreva/);
    expect(db.contact.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe("windowOf", () => {
  it("reports both windows", () => {
    expect(windowOf(null, NOW)).toEqual({ open: false, remainingMs: 0, humanAgentOpen: false });
    expect(windowOf(h(30), NOW)).toEqual({ open: false, remainingMs: 0, humanAgentOpen: true });
    expect(windowOf(h(24 * 8), NOW).humanAgentOpen).toBe(false);
  });
});

describe("quick replies", () => {
  it("derives the shortcut from the title and refuses a duplicate", async () => {
    const db = fakeDb({ contacts: [], messages: [], quickReplies: [] });
    const q = await createQuickReply(db, { title: "Preço à vista", text: "R$ 100" });
    expect(q.shortcut).toBe("preco-a-vista");
    await expect(
      createQuickReply(db, { title: "x", text: "y", shortcut: "Preço à vista" }),
    ).rejects.toThrow("/preco-a-vista");
  });

  it("validates title, text and shortcut", async () => {
    const db = fakeDb({ contacts: [], messages: [] });
    await expect(createQuickReply(db, { title: " ", text: "y" })).rejects.toThrow(/título/);
    await expect(createQuickReply(db, { title: "x", text: " " })).rejects.toThrow(/texto/);
    await expect(createQuickReply(db, { title: "x", text: "y", shortcut: "!!!" })).rejects.toThrow(
      /atalho/,
    );
    expect(normalizeShortcut("  Horário de Atendimento ")).toBe("horario-de-atendimento");
  });
});

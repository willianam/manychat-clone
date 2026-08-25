import type { ConversationRow, Thread, ThreadContact, ThreadMessage } from "../../../server/inbox";

export const NOW = new Date("2026-08-27T15:00:00Z");
export const h = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

export function row(id: string, patch: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id,
    name: `Pessoa ${id}`,
    username: `user_${id}`,
    profilePic: null,
    lastMessageAt: h(1),
    lastInboundAt: h(1),
    automationPaused: false,
    subscribed: true,
    windowOpen: true,
    unread: 0,
    preview: { text: "última mensagem", direction: "INBOUND", status: "DELIVERED", at: h(1) },
    ...patch,
  };
}

let seq = 0;
export function message(patch: Partial<ThreadMessage> = {}): ThreadMessage {
  seq++;
  return {
    id: `m${seq}`,
    direction: "INBOUND",
    text: `mensagem ${seq}`,
    status: "DELIVERED",
    error: null,
    payload: null,
    createdAt: h(2 - seq * 0.01),
    ...patch,
  };
}

export function contact(patch: Partial<ThreadContact> = {}): ThreadContact {
  return {
    id: "c1",
    igScopedId: "ig-1",
    name: "Ana Souza",
    username: "ana",
    profilePic: null,
    source: "dm",
    subscribed: true,
    automationPaused: false,
    lastInboundAt: h(1),
    lastReadAt: null,
    createdAt: h(200),
    tags: [{ id: "t1", name: "cliente", color: "#6366f1" }],
    fields: [{ key: "cidade", value: "Recife", label: "Cidade" }],
    notes: [{ id: "n1", text: "Prefere áudio", createdAt: h(5) }],
    ...patch,
  };
}

export function thread(patch: Partial<Thread> = {}): Thread {
  return {
    contact: contact(),
    messages: [message(), message({ direction: "OUTBOUND", status: "READ", text: "olá!" })],
    nextBefore: null,
    activeFlow: null,
    window: { open: true, remainingMs: 23 * 3_600_000, humanAgentOpen: true },
    ...patch,
  };
}

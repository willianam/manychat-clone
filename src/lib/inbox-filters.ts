/**
 * The conversation filters, shared by the server query and the client
 * list. Lives outside server/inbox.ts so the list can import it without
 * dragging the Instagram client and Prisma into the browser bundle.
 */
export type ConversationFilter = "all" | "unread" | "paused" | "open-window";

export const CONVERSATION_FILTERS: readonly ConversationFilter[] = [
  "all",
  "unread",
  "paused",
  "open-window",
];

export const FILTER_LABEL: Record<ConversationFilter, string> = {
  all: "Todas",
  unread: "Não lidas",
  paused: "Pausadas",
  "open-window": "Janela aberta",
};

export function parseConversationFilter(raw: string | undefined): ConversationFilter {
  return CONVERSATION_FILTERS.find((f) => f === raw) ?? "all";
}

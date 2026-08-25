import type { ConversationFilter } from "@/lib/inbox-filters";

export type InboxQuery = {
  filter?: ConversationFilter;
  q?: string;
  c?: string;
  cursor?: string;
  before?: string;
};

/** Every inbox link goes through here so filter and search survive navigation. */
export function inboxHref(query: InboxQuery): string {
  const params = new URLSearchParams();
  if (query.filter && query.filter !== "all") params.set("filter", query.filter);
  if (query.q) params.set("q", query.q);
  if (query.c) params.set("c", query.c);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.before) params.set("before", query.before);
  const qs = params.toString();
  return qs ? `/inbox?${qs}` : "/inbox";
}

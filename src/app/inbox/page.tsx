import { db } from "../../server/db";
import {
  listConversations,
  listQuickReplies,
  parseConversationFilter,
  thread,
} from "../../server/inbox";
import { InboxScreen } from "./InboxScreen";

export const dynamic = "force-dynamic";

/**
 * /inbox — the live chat.
 *
 * All state is in the URL (filter, q, c = contact, cursor, before), so the
 * page is a pure function of the request and the 10 s poll re-renders it
 * without any client cache to keep in sync.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string;
    q?: string;
    c?: string;
    cursor?: string;
    before?: string;
  }>;
}) {
  const sp = await searchParams;
  const filter = parseConversationFilter(sp.filter);
  const q = sp.q?.trim() ?? "";
  const before = sp.before ? new Date(sp.before) : undefined;
  const now = new Date();

  const [page, t, quickReplies] = await Promise.all([
    listConversations(db, { filter, q, cursor: sp.cursor, now }),
    sp.c
      ? thread(db, sp.c, {
          before: before && !Number.isNaN(before.getTime()) ? before : undefined,
          now,
        })
      : Promise.resolve(null),
    listQuickReplies(db),
  ]);

  return (
    <InboxScreen
      conversations={page.items}
      nextCursor={page.nextCursor}
      filter={filter}
      q={q}
      selectedId={sp.c}
      thread={t}
      quickReplies={quickReplies}
      now={now}
    />
  );
}

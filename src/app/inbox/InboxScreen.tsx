"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import type { QuickReplyTemplate } from "@prisma/client";
import type { ConversationRow, Thread as ThreadData } from "../../server/inbox";
import type { ConversationFilter } from "@/lib/inbox-filters";
import { EmptyState } from "@/components/ui/empty-state";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/ui/cn";
import { ConversationList } from "./ConversationList";
import { ContactPanel } from "./ContactPanel";
import { Thread } from "./Thread";
import { inboxHref } from "./href";

/**
 * Three columns on a wide screen (list | thread | contact), two on a
 * laptop (the contact panel becomes a sheet), one on a phone: the list, or
 * the thread with a back button, decided by whether a conversation is in
 * the URL.
 */
export function InboxScreen({
  conversations,
  nextCursor,
  filter,
  q,
  selectedId,
  thread,
  quickReplies,
  now,
}: {
  conversations: ConversationRow[];
  nextCursor: string | null;
  filter: ConversationFilter;
  q: string;
  selectedId?: string;
  thread: ThreadData | null;
  quickReplies: QuickReplyTemplate[];
  now: Date;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const showThread = !!selectedId;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 w-full">
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r bg-card md:flex md:w-80 lg:w-[340px]",
          showThread ? "hidden" : "flex",
        )}
        aria-label="Conversas"
      >
        <ConversationList
          items={conversations}
          filter={filter}
          q={q}
          selectedId={selectedId}
          nextCursor={nextCursor}
          now={now}
        />
      </aside>

      <section
        className={cn(
          "min-w-0 flex-1 flex-col bg-background md:flex",
          showThread ? "flex" : "hidden",
        )}
        aria-label="Conversa"
      >
        {thread ? (
          <Thread
            thread={thread}
            quickReplies={quickReplies}
            backHref={inboxHref({ filter, q })}
            olderHref={
              thread.nextBefore
                ? inboxHref({
                    filter,
                    q,
                    c: thread.contact.id,
                    before: thread.nextBefore.toISOString(),
                  })
                : null
            }
            onOpenDetails={() => setDetailsOpen(true)}
            now={now}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessageSquare}
              title={selectedId ? "Conversa não encontrada." : "Escolha uma conversa."}
              description={
                selectedId
                  ? "O contato pode ter sido removido."
                  : "As mensagens aparecem aqui; a automação continua rodando até você pausar."
              }
              className="w-full max-w-sm border-0 bg-transparent"
            />
          </div>
        )}
      </section>

      {thread && (
        <>
          <aside
            className="hidden w-[300px] shrink-0 flex-col border-l bg-card xl:flex"
            aria-label="Contato"
          >
            <ContactPanel contact={thread.contact} now={now} />
          </aside>
          <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
            <SheetContent side="right" className="w-[320px] p-0 sm:max-w-[320px]">
              <SheetTitle className="sr-only">Detalhes do contato</SheetTitle>
              <ContactPanel contact={thread.contact} now={now} />
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}

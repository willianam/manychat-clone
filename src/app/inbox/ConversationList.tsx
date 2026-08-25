"use client";

import Link from "next/link";
import { Inbox, PauseCircle, Search } from "lucide-react";
import type { ConversationRow } from "../../server/inbox";
import { CONVERSATION_FILTERS, FILTER_LABEL, type ConversationFilter } from "@/lib/inbox-filters";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/ui/cn";
import { relativeTime } from "@/lib/ui/time";
import { inboxHref } from "./href";
import { Avatar } from "./Avatar";

/**
 * Left column: filter, search and the conversation rows. Pure navigation —
 * every control is a link or a GET form, so the URL is the whole state and
 * the live poll can re-render it without losing anything.
 */
export function ConversationList({
  items,
  filter,
  q,
  selectedId,
  nextCursor,
  now = new Date(),
}: {
  items: ConversationRow[];
  filter: ConversationFilter;
  q: string;
  selectedId?: string;
  nextCursor: string | null;
  now?: Date;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b p-3">
        <form action="/inbox" method="get" role="search" className="relative">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome ou @usuário"
            aria-label="Buscar conversas"
            className="pl-8"
          />
        </form>
        <nav aria-label="Filtro" className="flex flex-wrap gap-1">
          {CONVERSATION_FILTERS.map((f) => (
            <Link
              key={f}
              href={inboxHref({ filter: f, q, c: selectedId })}
              aria-current={f === filter ? "page" : undefined}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                f === filter
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {FILTER_LABEL[f]}
            </Link>
          ))}
        </nav>
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="m-3"
          icon={Inbox}
          title={q ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}
          description={
            q
              ? "Tente outro nome ou usuário."
              : "As conversas aparecem aqui assim que alguém escrever para a conta conectada."
          }
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversas">
          {items.map((c) => (
            <li key={c.id}>
              <ConversationItem
                row={c}
                selected={c.id === selectedId}
                filter={filter}
                q={q}
                now={now}
              />
            </li>
          ))}
          {nextCursor && (
            <li className="p-3 text-center">
              <Button asChild variant="outline" size="sm">
                <Link href={inboxHref({ filter, q, c: selectedId, cursor: nextCursor })}>
                  Carregar mais
                </Link>
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ConversationItem({
  row,
  selected,
  filter,
  q,
  now,
}: {
  row: ConversationRow;
  selected: boolean;
  filter: ConversationFilter;
  q: string;
  now: Date;
}) {
  const name = row.name ?? (row.username ? `@${row.username}` : "Contato sem nome");
  const unread = row.unread > 0;
  const previewText = row.preview?.text?.trim() || "—";

  return (
    <Link
      href={inboxHref({ filter, q, c: row.id })}
      aria-current={selected ? "true" : undefined}
      data-unread={unread || undefined}
      className={cn(
        "flex gap-3 border-b px-3 py-2.5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected && "bg-primary/5",
      )}
    >
      <Avatar name={name} src={row.profilePic} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
            {name}
          </span>
          {row.automationPaused && (
            <PauseCircle
              className="h-3.5 w-3.5 shrink-0 text-amber-600"
              aria-label="Automação pausada"
            />
          )}
          {row.lastMessageAt && (
            <span
              className="ml-auto shrink-0 text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              {relativeTime(row.lastMessageAt, now)}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span
            className={cn("truncate text-xs", unread ? "text-foreground" : "text-muted-foreground")}
          >
            {row.preview?.direction === "OUTBOUND" && (
              <span className="text-muted-foreground">Você: </span>
            )}
            {previewText}
          </span>
          {unread && (
            <span
              className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
              aria-label={`${row.unread} não lidas`}
            >
              {row.unread > 99 ? "99+" : row.unread}
            </span>
          )}
          {!unread && !row.windowOpen && (
            <span
              className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300"
              title="Janela de 24h fechada"
              aria-hidden
            />
          )}
        </div>
      </div>
    </Link>
  );
}

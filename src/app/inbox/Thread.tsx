"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Info, PauseCircle, PlayCircle, Workflow } from "lucide-react";
import type { QuickReplyTemplate } from "@prisma/client";
import type { Thread as ThreadData } from "../../server/inbox";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { StatusPill } from "@/components/ui/status-pill";
import { withToast } from "@/lib/ui/action-toast";
import { calendarDay } from "@/lib/ui/time";
import { markReadAction, setPausedAction } from "./actions";
import { Avatar } from "./Avatar";
import { MessageBubble } from "./MessageBubble";
import { ReplyBox } from "./ReplyBox";

/**
 * Middle column: header, automation banner, bubbles and the composer.
 *
 * Opening a thread marks it read (an effect, so the mark lands after the
 * server rendered the unread state, never during it). The scroll sits at
 * the bottom on every render because that is where the new message is.
 */
export function Thread({
  thread: t,
  quickReplies,
  backHref,
  olderHref,
  onOpenDetails,
  now = new Date(),
}: {
  thread: ThreadData;
  quickReplies: QuickReplyTemplate[];
  backHref: string;
  olderHref: string | null;
  onOpenDetails?: () => void;
  now?: Date;
}) {
  const router = useRouter();
  const { contact, messages, activeFlow, window: w } = t;
  const name = contact.name ?? (contact.username ? `@${contact.username}` : "Contato sem nome");
  const [pausing, setPausing] = useState(false);

  const hasUnread = messages.some(
    (m) => m.direction === "INBOUND" && (!contact.lastReadAt || m.createdAt > contact.lastReadAt),
  );
  useEffect(() => {
    // A read mark that fails to land is not worth a toast; the next open retries.
    if (hasUnread) markReadAction(contact.id).catch(() => {});
  }, [contact.id, hasUnread]);

  async function setPaused(paused: boolean) {
    setPausing(true);
    const ok = await withToast(
      async () => {
        await setPausedAction(contact.id, paused);
        return true;
      },
      {
        success: paused ? "Automação pausada para este contato." : "Automação retomada.",
        error: "Não foi possível alterar a automação.",
      },
    );
    setPausing(false);
    if (ok) router.refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="md:hidden" aria-label="Voltar">
          <Link href={backHref}>
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <Avatar name={name} src={contact.profilePic} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{name}</h2>
            {!contact.subscribed && <StatusPill tone="destructive">descadastrado</StatusPill>}
            {contact.automationPaused && <StatusPill tone="warning">automação pausada</StatusPill>}
          </div>
          {contact.username && (
            <p className="truncate text-xs text-muted-foreground">@{contact.username}</p>
          )}
        </div>
        <StatusPill tone={w.open ? "success" : w.humanAgentOpen ? "warning" : "neutral"}>
          {w.open ? "janela aberta" : w.humanAgentOpen ? "só atendimento humano" : "fora da janela"}
        </StatusPill>
        {onOpenDetails && (
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden"
            aria-label="Detalhes do contato"
            onClick={onOpenDetails}
          >
            <Info aria-hidden />
          </Button>
        )}
      </header>

      {(activeFlow || contact.automationPaused) && (
        <div className="border-b px-3 py-2">
          <Callout
            tone={contact.automationPaused ? "warning" : "info"}
            className="py-2"
            aria-label="Automação"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Workflow className="h-4 w-4 shrink-0" aria-hidden />
                {contact.automationPaused ? (
                  <span>
                    Automação pausada; nenhum fluxo inicia ou avança para este contato.
                    {activeFlow && (
                      <>
                        {" "}
                        Fluxo <strong>{activeFlow.flowName}</strong> parado em{" "}
                        {activeFlow.nodeLabel ?? activeFlow.nodeId ?? "início"}.
                      </>
                    )}
                  </span>
                ) : (
                  <span>
                    Fluxo <strong>{activeFlow!.flowName}</strong>
                    {activeFlow!.status === "WAITING_INPUT" ? " aguardando resposta em " : " em "}
                    {activeFlow!.nodeLabel ?? activeFlow!.nodeId ?? "início"}
                  </span>
                )}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto bg-background"
                disabled={pausing}
                onClick={() => void setPaused(!contact.automationPaused)}
              >
                {contact.automationPaused ? (
                  <>
                    <PlayCircle aria-hidden /> Retomar automação
                  </>
                ) : (
                  <>
                    <PauseCircle aria-hidden /> Pausar automação
                  </>
                )}
              </Button>
            </div>
          </Callout>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" role="log" aria-label="Mensagens">
        {olderHref && (
          <div className="mb-3 text-center">
            <Button asChild variant="outline" size="sm">
              <Link href={olderHref}>Carregar anteriores</Link>
            </Button>
          </div>
        )}
        <div className="space-y-2">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || calendarDay(prev.createdAt) !== calendarDay(m.createdAt);
            return (
              <div key={m.id} className="space-y-2">
                {newDay && (
                  <div
                    className="my-2 text-center text-[11px] text-muted-foreground"
                    suppressHydrationWarning
                  >
                    {calendarDay(m.createdAt)}
                  </div>
                )}
                <MessageBubble message={m} now={now} />
              </div>
            );
          })}
        </div>
        <ScrollAnchor key={messages[messages.length - 1]?.id} />
      </div>

      {!contact.automationPaused && !activeFlow && (
        <div className="px-3 pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            disabled={pausing}
            onClick={() => void setPaused(true)}
          >
            <PauseCircle aria-hidden /> Pausar automação para este contato
          </Button>
        </div>
      )}

      <ReplyBox contactId={contact.id} window={w} quickReplies={quickReplies} />
    </div>
  );
}

/** Scrolls itself into view on mount; remounts (via key) when the last message changes. */
function ScrollAnchor() {
  useEffect(() => {
    const el = document.getElementById("inbox-scroll-anchor");
    el?.scrollIntoView({ block: "end" });
  }, []);
  return <div id="inbox-scroll-anchor" aria-hidden />;
}

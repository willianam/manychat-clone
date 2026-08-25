"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Send, Zap } from "lucide-react";
import type { QuickReplyTemplate } from "@prisma/client";
import type { MessagingWindow } from "../../server/inbox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/ui/cn";
import { withToast } from "@/lib/ui/action-toast";
import { formatDuration } from "@/lib/ui/time";
import { replyAction } from "./actions";
import { QuickRepliesDialog } from "./QuickRepliesDialog";

/**
 * The composer.
 *
 * Keys: Enter and ⌘/Ctrl+Enter send, ⇧Enter breaks the line. Typing "/" at
 * the start opens the quick-reply picker, filtered by what follows; ↑↓
 * move, Enter or Tab insert, Esc closes.
 *
 * The window counter starts from the server's `remainingMs` and ticks
 * locally, so the label is right even while the tab sat in the background.
 */
export function ReplyBox({
  contactId,
  window: w,
  quickReplies,
  onSent,
}: {
  contactId: string;
  window: MessagingWindow;
  quickReplies: QuickReplyTemplate[];
  onSent?: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [humanAgent, setHumanAgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState(w.remainingMs);
  const [cursor, setCursor] = useState(0);
  // Esc closes the shortcut picker. The picker is derived from the draft, so
  // dismissing it needs its own flag — clearing the text would throw away
  // what the operator typed.
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Tick the counter from the moment this render's value arrived.
  useEffect(() => {
    setRemaining(w.remainingMs);
    const arrivedAt = Date.now();
    const id = setInterval(
      () => setRemaining(Math.max(0, w.remainingMs - (Date.now() - arrivedAt))),
      30_000,
    );
    return () => clearInterval(id);
  }, [w.remainingMs]);

  const open = remaining > 0;
  const canSend = open || (humanAgent && w.humanAgentOpen);

  const query = text.startsWith("/") && !text.includes("\n") ? text.slice(1).toLowerCase() : null;
  const suggestions = useMemo(() => {
    if (query === null) return [];
    return quickReplies
      .filter((q) => q.shortcut.includes(query) || q.title.toLowerCase().includes(query))
      .slice(0, 8);
  }, [query, quickReplies]);
  const pickerOpen = suggestions.length > 0 && !pickerDismissed;

  useEffect(() => {
    setCursor(0);
    // A new query is a new picker: a past Esc must not keep it shut.
    setPickerDismissed(false);
  }, [query]);

  function pick(q: QuickReplyTemplate) {
    setText(q.text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await withToast(
      async () => {
        await replyAction(contactId, { text: body, humanAgent });
        return true;
      },
      { error: "Não foi possível enviar." },
    );
    setSending(false);
    if (ok) {
      setText("");
      onSent?.();
      router.refresh();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => (c + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => (c - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(suggestions[cursor]!);
        return;
      }
      if (e.key === "Escape") {
        // Close the picker only. This used to setText(""), so dismissing the
        // suggestions deleted the whole draft.
        e.preventDefault();
        setPickerDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="border-t bg-background p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            open ? "text-emerald-700" : w.humanAgentOpen ? "text-amber-700" : "text-rose-700",
          )}
          role="status"
          aria-live="polite"
        >
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {open
            ? `Janela fecha em ${formatDuration(remaining)}`
            : w.humanAgentOpen
              ? "Janela de 24h fechada"
              : "Fora da janela (mais de 7 dias)"}
        </span>
        {!open && w.humanAgentOpen && (
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="human-agent"
              checked={humanAgent}
              onCheckedChange={(v) => setHumanAgent(v === true)}
            />
            <Label htmlFor="human-agent" className="text-xs font-normal">
              Atendimento humano (tag HUMAN_AGENT, até 7 dias)
            </Label>
          </div>
        )}
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Zap className="h-3.5 w-3.5" aria-hidden />
          Respostas rápidas
        </button>
      </div>

      <div className="relative">
        {pickerOpen && (
          <ul
            role="listbox"
            aria-label="Respostas rápidas"
            className="absolute bottom-full left-0 z-10 mb-1 w-full max-w-md overflow-hidden rounded-lg border bg-popover shadow-md"
          >
            {suggestions.map((q, i) => (
              <li
                key={q.id}
                role="option"
                aria-selected={i === cursor}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(q);
                }}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  i === cursor ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span className="font-medium">/{q.shortcut}</span>
                <span className="ml-2 text-muted-foreground">{q.title}</span>
                <p className="truncate text-xs text-muted-foreground">{q.text}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            disabled={sending || !w.humanAgentOpen}
            placeholder={
              w.humanAgentOpen
                ? "Escreva uma resposta… (/ para respostas rápidas)"
                : "Este contato não pode receber mensagens agora."
            }
            aria-label="Resposta"
            className="min-h-[44px] resize-none"
          />
          <Button
            type="button"
            onClick={() => void send()}
            disabled={!canSend || !text.trim() || sending}
            aria-label="Enviar"
            title="Enter ou ⌘Enter para enviar · ⇧Enter quebra a linha"
          >
            <Send aria-hidden />
          </Button>
        </div>
      </div>

      <QuickRepliesDialog open={manageOpen} onOpenChange={setManageOpen} items={quickReplies} />
    </div>
  );
}

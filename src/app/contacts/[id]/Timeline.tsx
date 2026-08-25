"use client";

import { useState, useTransition } from "react";
import { loadTimeline } from "./actions";
import { Button } from "@/components/ui/button";
import { withToast } from "@/lib/ui/action-toast";
import { cn } from "@/lib/ui/cn";
import { describeTimelineItem, type TimelineItemDto, type TimelineTone } from "@/lib/ui/timeline";

const TONE: Record<TimelineTone, string> = {
  inbound: "bg-muted",
  outbound: "bg-primary/10",
  failed: "bg-rose-50 text-rose-800",
  flow: "text-indigo-800",
  note: "bg-amber-50 text-amber-900",
  event: "text-muted-foreground",
};

/** The merged history, newest first, with "load older" pagination by timestamp. */
export function Timeline({
  contactId,
  initial,
}: {
  contactId: string;
  initial: { items: TimelineItemDto[]; nextBefore: string | null };
}) {
  const [items, setItems] = useState(initial.items);
  const [nextBefore, setNextBefore] = useState(initial.nextBefore);
  const [pending, start] = useTransition();

  const more = () =>
    start(async () => {
      const page = await withToast(() => loadTimeline(contactId, nextBefore), {
        error: "Não foi possível carregar mais.",
      });
      if (!page) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextBefore(page.nextBefore);
    });

  return (
    <section aria-labelledby="timeline-h" className="rounded-xl border bg-card p-4">
      <h2 id="timeline-h" className="text-sm font-semibold">
        Linha do tempo
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nada aconteceu ainda com este contato.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {items.map((item) => {
            const { text, tone } = describeTimelineItem(item);
            const isMessage = item.kind === "message";
            return (
              <li
                key={`${item.kind}-${item.id}`}
                className={cn(
                  "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm",
                  isMessage || tone === "note" || tone === "failed" ? TONE[tone] : "py-1",
                  !isMessage && tone !== "note" && tone !== "failed" && TONE[tone],
                )}
              >
                <span className="whitespace-pre-wrap break-words">{text}</span>
                <time dateTime={item.at} className="text-xs text-muted-foreground">
                  {new Date(item.at).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      {nextBefore && (
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={more}>
            {pending ? "Carregando…" : "Carregar mais antigas"}
          </Button>
        </div>
      )}
    </section>
  );
}

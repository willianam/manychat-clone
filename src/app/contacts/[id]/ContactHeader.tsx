"use client";

import { useEffect, useState, useTransition } from "react";
import { setSubscribed } from "../actions";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { withToast } from "@/lib/ui/action-toast";
import { WINDOW_MS } from "@/lib/messaging-window";
import { formatRemaining, WINDOW_LABEL, windowState } from "@/lib/ui/window";

/**
 * Identity, origin, the 24h window as a live countdown, and the opt-out
 * switch. The countdown ticks every minute on the client; the server's
 * decision (`canSend`) is what the send dialog re-checks before sending.
 */
export function ContactHeader({
  contact,
}: {
  contact: {
    id: string;
    name: string | null;
    username: string | null;
    profilePic: string | null;
    source: string | null;
    subscribed: boolean;
    lastInboundAt: string | null;
    createdAt: string;
  };
}) {
  const [subscribed, setLocal] = useState(contact.subscribed);
  const [pending, start] = useTransition();

  useEffect(() => setLocal(contact.subscribed), [contact.subscribed]);

  const toggle = (next: boolean) => {
    setLocal(next);
    start(async () => {
      // `?? true` keeps a failure value intact for withToast to show.
      const ok = await withToast(() => setSubscribed(contact.id, next).then((r) => r ?? true), {
        success: next ? "Contato inscrito." : "Contato descadastrado.",
        error: "Não foi possível alterar a inscrição.",
      });
      if (ok === undefined) setLocal(!next);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4">
      <Avatar name={contact.name} username={contact.username} src={contact.profilePic} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">{contact.name ?? "—"}</h1>
        <p className="truncate text-sm text-muted-foreground">
          @{contact.username ?? "sem-user"}
          {contact.source && <> · origem: {contact.source}</>}
        </p>
        <div className="mt-2">
          <WindowCountdown lastInboundAt={contact.lastInboundAt} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="contact-subscribed"
          checked={subscribed}
          disabled={pending}
          onCheckedChange={toggle}
          aria-label="Inscrito"
        />
        <Label htmlFor="contact-subscribed" className="cursor-pointer">
          {subscribed ? "Inscrito" : "Descadastrado"}
        </Label>
      </div>
    </div>
  );
}

/** "dentro da janela · faltam 13h 20min", updated every minute. */
export function WindowCountdown({
  lastInboundAt,
  now: initialNow,
}: {
  lastInboundAt: string | null;
  /** Injectable for tests; defaults to the wall clock. */
  now?: Date;
}) {
  const [now, setNow] = useState(() => initialNow ?? new Date());
  useEffect(() => {
    if (initialNow) return;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [initialNow]);

  const last = lastInboundAt ? new Date(lastInboundAt) : null;
  const state = windowState(last, now);
  const remaining = last ? Math.max(0, WINDOW_MS - (now.getTime() - last.getTime())) : 0;

  return (
    <span className="inline-flex items-center gap-2 text-sm" aria-live="polite">
      <StatusPill tone={state === "in" ? "success" : "neutral"}>{WINDOW_LABEL[state]}</StatusPill>
      {state === "in" && (
        <span className="text-muted-foreground">faltam {formatRemaining(remaining)}</span>
      )}
      {state === "out" && last && (
        <span className="text-muted-foreground">
          última mensagem {last.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
        </span>
      )}
    </span>
  );
}

function Avatar({
  name,
  username,
  src,
}: {
  name: string | null;
  username: string | null;
  src: string | null;
}) {
  const initial = (name ?? username ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-muted-foreground"
    >
      {initial}
    </span>
  );
}

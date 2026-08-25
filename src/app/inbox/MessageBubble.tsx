import { AlertCircle, FileText, Mic } from "lucide-react";
import type { ThreadMessage } from "../../server/inbox";
import {
  attachmentsOf,
  expiryLabel,
  expiryStateOf,
  type StoredAttachment,
} from "../../server/inbound-attachments";
import { cn } from "@/lib/ui/cn";
import { messageStatusLabel } from "@/lib/ui/labels";
import { clockTime } from "@/lib/ui/time";

/**
 * One message. Inbound on the left, outbound on the right with its
 * delivery state; inbound attachments render inline with the expiry of
 * their Meta CDN link, which is the only copy we have (see
 * server/inbound-attachments.ts).
 */
export function MessageBubble({
  message,
  now = new Date(),
}: {
  message: ThreadMessage;
  now?: Date;
}) {
  const out = message.direction === "OUTBOUND";
  const attachments = out ? [] : attachmentsOf(message.payload);
  const failed = message.status === "FAILED";

  return (
    <div
      className={cn("flex", out ? "justify-end" : "justify-start")}
      data-direction={message.direction}
    >
      <div className={cn("max-w-[80%] md:max-w-[65%]", out ? "items-end" : "items-start")}>
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm",
            out
              ? failed
                ? "rounded-br-sm border border-rose-200 bg-rose-50 text-rose-900"
                : "rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm bg-muted text-foreground",
          )}
        >
          {attachments.length > 0 && (
            <div className="mb-1 space-y-2">
              {attachments.map((a, i) => (
                <Attachment key={i} attachment={a} now={now} />
              ))}
            </div>
          )}
          {message.text && !(attachments.length > 0 && message.text.startsWith("[")) && (
            <span>{message.text}</span>
          )}
        </div>
        <div
          className={cn(
            "mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground",
            out ? "justify-end" : "justify-start",
          )}
        >
          <time dateTime={message.createdAt.toISOString()} suppressHydrationWarning>
            {clockTime(message.createdAt)}
          </time>
          {out && (
            <span className={cn(failed && "text-rose-700")}>
              · {messageStatusLabel(message.status)}
            </span>
          )}
        </div>
        {failed && message.error && (
          <p className="mt-0.5 flex max-w-full items-start gap-1 text-[11px] text-rose-700">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span className="break-words">{message.error}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function Attachment({ attachment: a, now }: { attachment: StoredAttachment; now: Date }) {
  const state = expiryStateOf(a, now);
  const label = expiryLabel(a, now);
  const expired = state === "expired";
  const badge = (
    <span
      className={cn(
        "text-[11px]",
        state === "ok" ? "text-muted-foreground" : "font-medium text-amber-700",
        expired && "text-rose-700",
      )}
    >
      {label}
    </span>
  );

  if (a.type === "image" && !expired) {
    return (
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.url} alt={a.title ?? "Imagem recebida"} className="max-h-72 rounded-lg" />
        <figcaption>{badge}</figcaption>
      </figure>
    );
  }
  if (a.type === "audio" && !expired) {
    return (
      <div className="space-y-1">
        <audio controls src={a.url} className="max-w-full" aria-label="Áudio recebido" />
        {badge}
      </div>
    );
  }
  const Icon = a.type === "audio" ? Mic : FileText;
  const name =
    a.title ??
    (a.type === "image"
      ? "imagem"
      : a.type === "audio"
        ? "áudio"
        : a.type === "video"
          ? "vídeo"
          : "arquivo");
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background/60 px-2.5 py-1.5">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        {expired ? (
          <span className="block truncate text-sm">{name}</span>
        ) : (
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm underline underline-offset-2"
          >
            {name}
          </a>
        )}
        {badge}
      </div>
    </div>
  );
}

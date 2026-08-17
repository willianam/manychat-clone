import type { PrismaClient, Prisma } from "@prisma/client";

/**
 * Inbound attachment capture.
 *
 * **The bug this exists for.** When someone sends us a photo, a voice note or
 * a reel, Meta does not hand us the file — it hands us a CDN URL that stops
 * resolving roughly seven days later. Until now the webhook dropped inbound
 * attachments entirely (it skipped any event without `message.text`), so the
 * media was lost the moment it arrived. Even once captured, a stored URL is a
 * wasting asset: it works today and 404s next week.
 *
 * This module does the cheap half of the fix — capture the metadata and be
 * loud about the deadline. It deliberately does NOT download or re-upload the
 * bytes to object storage; that needs a storage bucket, a queue and a size
 * budget, and none of that belongs on a 15-second webhook. What it guarantees
 * is that the information needed to do that later (URL, kind, arrival time,
 * computed expiry) is on disk instead of gone.
 *
 * Storage lives in `Message.payload`, which is already a Json column, so this
 * ships without a migration — worth noting because the Prisma schema is owned
 * by another workstream right now.
 */

/** Meta's inbound CDN links stop resolving after this long. */
export const ATTACHMENT_TTL_DAYS = 7;

/** How close to expiry the UI starts warning. */
export const ATTACHMENT_WARN_DAYS = 2;

/** The attachment shape as it arrives on the messaging webhook. */
export type MetaAttachment = {
  type?: string;
  payload?: { url?: string; title?: string; sticker_id?: number | string };
};

/** One captured attachment, as persisted under `Message.payload`. */
export type StoredAttachment = {
  /** "image" | "video" | "audio" | "file" | "share" | "story_mention" | … */
  type: string;
  /** The Meta CDN URL. Expires — see `expiresAt`. */
  url: string;
  title?: string;
  /** When the webhook delivered it. */
  capturedAt: string;
  /** capturedAt + 7 days, precomputed so the UI needn't know the rule. */
  expiresAt: string;
};

export type InboundPayload = {
  attachments: StoredAttachment[];
};

/**
 * Normalise webhook attachments into the stored shape.
 *
 * Attachments without a URL — stickers and some share types arrive that way —
 * are dropped rather than stored as a row with nothing to fetch.
 *
 * `now` is injectable so tests don't depend on wall-clock time.
 */
export function captureAttachments(
  raw: MetaAttachment[] | undefined,
  now: Date = new Date(),
): StoredAttachment[] {
  if (!raw?.length) return [];

  const expiresAt = new Date(
    now.getTime() + ATTACHMENT_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  return raw.flatMap((a) => {
    const url = a.payload?.url;
    if (!url) return [];
    return [
      {
        type: a.type ?? "unknown",
        url,
        ...(a.payload?.title ? { title: a.payload.title } : {}),
        capturedAt: now.toISOString(),
        expiresAt,
      },
    ];
  });
}

/** Days left before a captured URL goes dead. Negative once it has. */
export function daysUntilExpiry(a: StoredAttachment, now: Date = new Date()): number {
  const ms = new Date(a.expiresAt).getTime() - now.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export type ExpiryState = "ok" | "expiring" | "expired";

/** How the UI should treat a captured attachment right now. */
export function expiryStateOf(a: StoredAttachment, now: Date = new Date()): ExpiryState {
  const days = daysUntilExpiry(a, now);
  if (days < 0) return "expired";
  if (days <= ATTACHMENT_WARN_DAYS) return "expiring";
  return "ok";
}

/** pt-BR label for the inbox badge. */
export function expiryLabel(a: StoredAttachment, now: Date = new Date()): string {
  const days = daysUntilExpiry(a, now);
  if (days < 0) return "link expirado";
  if (days === 0) return "expira hoje";
  if (days === 1) return "expira amanhã";
  return `expira em ${days} dias`;
}

/** Read attachments back off a Message row, tolerating legacy/absent payloads. */
export function attachmentsOf(payload: unknown): StoredAttachment[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (a): a is StoredAttachment =>
      !!a && typeof a === "object" && typeof (a as StoredAttachment).url === "string",
  );
}

/**
 * Short inbox line for a message whose content is an attachment.
 *
 * An inbound photo has no text, and a blank inbox row reads as a bug — the
 * same reasoning as `previewOf` on the outbound side.
 */
export function attachmentPreview(list: StoredAttachment[]): string {
  if (!list.length) return "";
  const names: Record<string, string> = {
    image: "imagem",
    video: "vídeo",
    audio: "áudio",
    file: "arquivo",
    share: "publicação",
    story_mention: "menção no story",
  };
  if (list.length === 1) return `[${names[list[0]!.type] ?? list[0]!.type}]`;
  return `[${list.length} anexos]`;
}

/**
 * Persist an inbound message together with whatever media came attached.
 *
 * This is the single call the webhook needs. It is idempotent on `externalId`
 * (the Meta `mid`, which is unique in the schema), so a replayed delivery
 * updates the existing row rather than exploding on the unique constraint.
 *
 * Returns the captured attachments so the caller can decide whether there was
 * anything worth reacting to.
 */
export async function recordInboundMessage(
  db: PrismaClient,
  args: {
    contactId: string;
    mid?: string;
    text?: string;
    attachments?: MetaAttachment[];
  },
  now: Date = new Date(),
): Promise<StoredAttachment[]> {
  const captured = captureAttachments(args.attachments, now);

  // Text wins as the inbox line; an attachment-only message gets a summary.
  const text = args.text ?? attachmentPreview(captured);

  const payload: Prisma.InputJsonValue | undefined = captured.length
    ? ({ attachments: captured } satisfies InboundPayload as unknown as Prisma.InputJsonValue)
    : undefined;

  const data = {
    contactId: args.contactId,
    direction: "INBOUND" as const,
    text,
    status: "DELIVERED" as const,
    externalId: args.mid,
    ...(payload ? { payload } : {}),
  };

  if (args.mid) {
    await db.message.upsert({
      where: { externalId: args.mid },
      create: data,
      update: { ...(payload ? { payload } : {}), text },
    });
  } else {
    await db.message.create({ data });
  }

  return captured;
}

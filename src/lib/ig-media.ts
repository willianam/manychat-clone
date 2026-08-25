/**
 * Parsing for the Instagram media list (`GET /me/media`).
 *
 * Kept separate from server/instagram.ts and free of any I/O so the parsing
 * can be tested without a network or a token — the shape of what Meta hands
 * back is exactly the part that breaks silently on an API version bump.
 *
 * The parser is deliberately forgiving about individual items: one malformed
 * entry drops out of the list rather than failing the whole request. A post
 * selector that shows nine of ten posts is usable; one that shows an error
 * because a single archived Reel lacks a thumbnail is not.
 */

export type IgMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";

export type IgMedia = {
  id: string;
  /** Post caption, trimmed. Empty when the post has none. */
  caption: string;
  mediaType: IgMediaType | null;
  /** Best available still for a thumbnail. Null when Meta sent neither. */
  thumbnailUrl: string | null;
  permalink: string | null;
  /** ISO-8601, as Meta sends it. Null when absent. */
  timestamp: string | null;
};

/** Fields we ask Meta for. Exported so the caller and the test agree. */
export const MEDIA_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";

/**
 * Turn a `/me/media` response body into a clean list.
 *
 * `thumbnail_url` is only present for VIDEO; for IMAGE and CAROUSEL_ALBUM the
 * still lives in `media_url`. Preferring `thumbnail_url` and falling back to
 * `media_url` covers all three without branching on media_type — and a video
 * whose thumbnail has not finished processing still gets its media_url.
 */
export function parseMediaList(body: unknown): IgMedia[] {
  if (!isRecord(body)) return [];
  const data = body.data;
  if (!Array.isArray(data)) return [];

  const out: IgMedia[] = [];
  for (const raw of data) {
    const item = parseMediaItem(raw);
    if (item) out.push(item);
  }
  return out;
}

/** One entry. Returns null when there is no id — an item we can't reference. */
export function parseMediaItem(raw: unknown): IgMedia | null {
  if (!isRecord(raw)) return null;

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) return null;

  const thumbnail = str(raw.thumbnail_url) ?? str(raw.media_url) ?? null;

  return {
    id,
    caption: typeof raw.caption === "string" ? raw.caption.trim() : "",
    mediaType: mediaType(raw.media_type),
    thumbnailUrl: thumbnail,
    permalink: str(raw.permalink),
    timestamp: str(raw.timestamp),
  };
}

/**
 * A short label for a post in a picker.
 *
 * The caption is the only thing that tells two posts apart at a glance, so it
 * leads; a post without one falls back to naming its type, never to a bare
 * id, which reads as noise.
 */
export function mediaLabel(m: IgMedia): string {
  const firstLine = m.caption
    .split("\n")
    .find((l) => l.trim() !== "")
    ?.trim();
  if (firstLine) {
    return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  }
  switch (m.mediaType) {
    case "VIDEO":
      return "Reel sem legenda";
    case "CAROUSEL_ALBUM":
      return "Carrossel sem legenda";
    case "IMAGE":
      return "Foto sem legenda";
    default:
      return "Publicação sem legenda";
  }
}

function mediaType(v: unknown): IgMediaType | null {
  return v === "IMAGE" || v === "VIDEO" || v === "CAROUSEL_ALBUM" ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

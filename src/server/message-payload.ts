import type { FlowButton, FlowNodeData, LIMITS as L } from "../lib/flow-schema";
import { LIMITS, byteLength } from "../lib/flow-schema";
import {
  accountTimeZone,
  parseLocalDateTime,
  wallClockIn,
  wallClockToDate,
  type WallClock,
} from "../lib/timezone";

/**
 * Translates flow nodes into Instagram message payloads.
 *
 * Kept apart from instagram.ts so the wire format can be unit-tested without
 * mocking the network: every function here is pure.
 *
 * Postback payloads carry the routing decision. A tapped button arrives back
 * on the `messaging_postbacks` webhook as `payload`, and the runner uses it
 * to pick the next node — which is why the format is fixed here as
 * `<nodeId>:<handle>` and parsed by `parsePostback`.
 */

/**
 * Cut a string to fit a byte budget without splitting a character.
 *
 * A naive slice on code units can cut an emoji in half and produce invalid
 * UTF-8, which the Graph API rejects outright.
 */
export function truncateBytes(s: string, maxBytes: number): string {
  if (byteLength(s) <= maxBytes) return s;
  let out = "";
  for (const ch of s) {
    if (byteLength(out + ch) > maxBytes) break;
    out += ch;
  }
  return out;
}

export function postbackPayload(nodeId: string, handle: string): string {
  return `${nodeId}:${handle}`;
}

export function parsePostback(payload: string): { nodeId: string; handle: string } | null {
  const i = payload.indexOf(":");
  if (i <= 0 || i === payload.length - 1) return null;
  return { nodeId: payload.slice(0, i), handle: payload.slice(i + 1) };
}

function toApiButton(b: FlowButton, nodeId: string) {
  if (b.type === "url") {
    return { type: "web_url", title: b.title, url: b.url };
  }
  return { type: "postback", title: b.title, payload: postbackPayload(nodeId, b.id) };
}

/** Plain text, or a button template when the node carries buttons. */
export function buildMessage(
  nodeId: string,
  d: Extract<FlowNodeData, { kind: "message" }>,
): Record<string, unknown> {
  if (!d.buttons?.length) return { text: d.text };

  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: truncateBytes(d.text, LIMITS.buttonTemplateText),
        buttons: d.buttons.slice(0, LIMITS.buttons).map((b) => toApiButton(b, nodeId)),
      },
    },
  };
}

/**
 * Text plus tappable options. Instagram truncates titles past 20 chars
 * silently, so we cut them here to keep the canvas honest about what ships.
 */
export function buildQuickReply(
  nodeId: string,
  d: Extract<FlowNodeData, { kind: "quickreply" }>,
): Record<string, unknown> {
  return {
    text: d.text,
    quick_replies: d.options.slice(0, LIMITS.quickReplies).map((o) => ({
      content_type: "text",
      title: truncateBytes(o.title, LIMITS.quickReplyTitle),
      payload: postbackPayload(nodeId, o.id),
    })),
  };
}

/** The quick-reply handle a "Pular" tap on a question carries. */
export const SKIP_HANDLE = "skip";

/**
 * A question: plain text, plus a "Pular" quick reply when the author allows
 * skipping and one chip per accepted answer when the input type is `option`.
 * Instagram caps quick replies at 13, so the skip chip takes the last slot.
 */
export function buildQuestion(
  nodeId: string,
  d: Extract<FlowNodeData, { kind: "question" }>,
): Record<string, unknown> {
  const chips: Array<{ title: string; payload: string }> = [];
  if (d.inputType === "option") {
    for (const o of d.options ?? [])
      chips.push({ title: o, payload: postbackPayload(nodeId, `opt:${o}`) });
  }
  if (d.allowSkip) chips.push({ title: "Pular", payload: postbackPayload(nodeId, SKIP_HANDLE) });
  if (!chips.length) return { text: d.text };
  return {
    text: d.text,
    quick_replies: chips.slice(0, LIMITS.quickReplies).map((c) => ({
      content_type: "text",
      title: truncateBytes(c.title, LIMITS.quickReplyTitle),
      payload: c.payload,
    })),
  };
}

/** Horizontally scrolling cards. */
export function buildCarousel(
  nodeId: string,
  d: Extract<FlowNodeData, { kind: "carousel" }>,
): Record<string, unknown> {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: d.cards.slice(0, LIMITS.carouselCards).map((c) => ({
          title: c.title,
          ...(c.subtitle ? { subtitle: c.subtitle } : {}),
          ...(c.imageUrl ? { image_url: c.imageUrl } : {}),
          ...(c.buttons?.length
            ? {
                buttons: c.buttons
                  .slice(0, LIMITS.carouselButtons)
                  .map((b) => toApiButton(b, nodeId)),
              }
            : {}),
        })),
      },
    },
  };
}

export function buildImage(d: Extract<FlowNodeData, { kind: "image" }>): Record<string, unknown> {
  return { attachment: { type: "image", payload: mediaPayload(d) } };
}

/**
 * Video, audio and PDF.
 *
 * All three use the singular `attachment` key with the kind as `type` — the
 * format is identical to an image, which is why one builder covers them:
 *
 *   {"attachment":{"type":"video","payload":{"url":"…"}}}
 *
 * `is_reusable` is kept for the same reason as images: re-sending the same
 * asset then costs an attachment id rather than a fresh upload.
 *
 * Note the node kinds map 1:1 onto the API's type strings — `file` is the
 * documented type for a PDF, so no translation table is needed.
 */
export function buildMedia(
  d: Extract<FlowNodeData, { kind: "video" | "audio" | "file" }>,
): Record<string, unknown> {
  return { attachment: { type: d.kind, payload: mediaPayload(d) } };
}

/**
 * An uploaded file is referenced by id; a hosted one by URL.
 *
 * `is_reusable` only applies to the URL form — an attachment_id is already
 * the result of a reusable upload, and sending the flag alongside it is
 * rejected.
 */
function mediaPayload(d: { url?: string; attachmentId?: string }): Record<string, unknown> {
  if (d.attachmentId) return { attachment_id: d.attachmentId };
  return { url: d.url, is_reusable: true };
}

/**
 * Album — several images in one message.
 *
 * This is the one payload that uses the PLURAL `attachments` array instead of
 * the singular `attachment` object. Sending an array under the singular key
 * is accepted by JSON but rejected by the Graph API, so the distinction is
 * load-bearing and covered by a test.
 */
export function buildAlbum(d: Extract<FlowNodeData, { kind: "album" }>): Record<string, unknown> {
  return {
    attachments: d.urls.slice(0, LIMITS.albumImages).map((url) => ({
      type: "image",
      payload: { url, is_reusable: true },
    })),
  };
}

/** One-line inbox summary for payloads that have no text of their own. */
export function previewOf(d: FlowNodeData): string {
  switch (d.kind) {
    case "message":
    case "question":
    case "quickreply":
      return d.text;
    case "carousel":
      return `[carrossel: ${d.cards.map((c) => c.title).join(", ")}]`;
    case "image":
      return d.caption ?? "[imagem]";
    case "video":
      return "[vídeo]";
    case "audio":
      return "[áudio]";
    case "file":
      return d.filename ? `[pdf: ${d.filename}]` : "[pdf]";
    case "album":
      return `[álbum: ${d.urls.length} ${d.urls.length === 1 ? "imagem" : "imagens"}]`;
    default:
      return "";
  }
}

/**
 * Next allowed send time for a delay node.
 *
 * Without a window this is just now + seconds. With one, the result is
 * pushed to the next moment inside the allowed hours — a 20h delay set at
 * 3am would otherwise wake someone's phone at 11pm.
 *
 * The hours are read on a clock in the account's timezone, not the server's:
 * Vercel runs on UTC, and an 8–22 window measured there is 5–19 in São
 * Paulo. `now` and `timeZone` are injectable so tests depend on neither the
 * wall clock nor the machine's zone.
 */
export function resumeAtFor(
  d: Extract<FlowNodeData, { kind: "delay" }>,
  now: Date = new Date(),
  timeZone: string = accountTimeZone(),
): Date {
  if (d.mode === "untilDate") {
    // An unparseable or past date resumes now: waiting forever on a typo is
    // the worse failure.
    const at = parseLocalDateTime(d.untilDate ?? "", timeZone);
    return at && at.getTime() > now.getTime() ? at : now;
  }
  if (d.mode === "untilReply") {
    return new Date(now.getTime() + (d.timeoutSeconds ?? 0) * 1000);
  }

  const at = new Date(now.getTime() + (d.seconds ?? 0) * 1000);
  if (!d.window) return at;

  const { fromHour, toHour } = d.window;
  const wall = wallClockIn(at, timeZone);
  const h = wall.hour;

  // Normal window, e.g. 8–22: inside means fromHour <= h < toHour.
  if (fromHour < toHour) {
    if (h >= fromHour && h < toHour) return at;
    return openingAt(wall, h < fromHour ? 0 : 1, fromHour, timeZone);
  }

  // Overnight window, e.g. 22–6: inside means h >= fromHour or h < toHour.
  if (h >= fromHour || h < toHour) return at;
  return openingAt(wall, 0, fromHour, timeZone);
}

/** `hour`:00 on the day `dayOffset` days after `wall`, in `timeZone`. */
function openingAt(wall: WallClock, dayOffset: number, hour: number, timeZone: string): Date {
  const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + dayOffset));
  return wallClockToDate(
    {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
      hour,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

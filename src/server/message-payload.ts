import type { FlowButton, FlowNodeData, LIMITS as L } from "../lib/flow-schema";
import { LIMITS } from "../lib/flow-schema";

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
        text: d.text.slice(0, LIMITS.buttonTemplateText),
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
      title: o.title.slice(0, LIMITS.quickReplyTitle),
      payload: postbackPayload(nodeId, o.id),
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

export function buildImage(
  d: Extract<FlowNodeData, { kind: "image" }>,
): Record<string, unknown> {
  return {
    attachment: { type: "image", payload: { url: d.url, is_reusable: true } },
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
 * `now` is injectable so tests don't depend on wall-clock time.
 */
export function resumeAtFor(
  d: Extract<FlowNodeData, { kind: "delay" }>,
  now: Date = new Date(),
): Date {
  const at = new Date(now.getTime() + d.seconds * 1000);
  if (!d.window) return at;

  const { fromHour, toHour } = d.window;
  const h = at.getHours();

  // Normal window, e.g. 8–22: inside means fromHour <= h < toHour.
  if (fromHour < toHour) {
    if (h >= fromHour && h < toHour) return at;
    if (h < fromHour) {
      const d2 = new Date(at);
      d2.setHours(fromHour, 0, 0, 0);
      return d2;
    }
    const d2 = new Date(at);
    d2.setDate(d2.getDate() + 1);
    d2.setHours(fromHour, 0, 0, 0);
    return d2;
  }

  // Overnight window, e.g. 22–6: inside means h >= fromHour or h < toHour.
  if (h >= fromHour || h < toHour) return at;
  const d2 = new Date(at);
  d2.setHours(fromHour, 0, 0, 0);
  return d2;
}

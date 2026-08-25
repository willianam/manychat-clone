import type { BroadcastContent } from "../lib/broadcast-content";
import {
  buildMessage,
  buildQuickReply,
  buildCarousel,
  buildImage,
  buildMedia,
  buildAlbum,
  previewOf,
} from "./message-payload";

/**
 * Turn a broadcast's content block into the wire payload plus inbox preview,
 * through the same builders the flow-runner uses. The node id becomes the
 * postback prefix; a broadcast has no node, so the broadcast id stands in.
 */
export function broadcastPayload(
  broadcastId: string,
  d: BroadcastContent,
): { payload: Record<string, unknown>; preview: string } {
  const preview = previewOf(d);
  switch (d.kind) {
    case "message":
      return { payload: buildMessage(broadcastId, d), preview };
    case "quickreply":
      return { payload: buildQuickReply(broadcastId, d), preview };
    case "carousel":
      return { payload: buildCarousel(broadcastId, d), preview };
    case "image":
      return { payload: buildImage(d), preview };
    case "album":
      return { payload: buildAlbum(d), preview };
    default:
      return { payload: buildMedia(d), preview };
  }
}

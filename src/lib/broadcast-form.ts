import { accountTimeZone, parseLocalDateTime } from "./timezone";
import { BroadcastContent } from "./broadcast-content";
import { parseMessageTag, type MessageTag } from "./messaging-window";

/**
 * What the broadcast form posts, validated. Kept apart from the server
 * action so the rules can be tested without Next's action runtime.
 */

export type BroadcastDraft = {
  name: string;
  /** Null when the body is a content block or a flow. */
  text: string | null;
  /** A sending node (lib/broadcast-content.ts), posted as JSON in `content`. */
  content: BroadcastContent | null;
  /** "Send a flow" instead of a message. */
  flowId: string | null;
  /** Message tag to send under; null = standard message, 24h window only. */
  tag: MessageTag | null;
  filterTagIds: string[];
  /** A saved segment; replaces `filterTagIds` when set. */
  segmentId: string | null;
  /** Instant to send at, or null to send as soon as it is queued. */
  scheduledAt: Date | null;
};

export function parseBroadcastForm(
  formData: FormData,
  opts: { now?: Date; timeZone?: string } = {},
): BroadcastDraft {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? accountTimeZone();

  const name =
    String(formData.get("name") ?? "")
      .trim()
      .slice(0, 120) || "Disparo sem nome";
  const flowId = String(formData.get("flowId") ?? "").trim() || null;
  const rawContent = String(formData.get("content") ?? "").trim();
  let content: BroadcastContent | null = null;
  if (rawContent) {
    let json: unknown;
    try {
      json = JSON.parse(rawContent);
    } catch {
      throw new Error("O bloco do disparo não é um JSON válido.");
    }
    content = BroadcastContent.parse(json);
  }
  const text = String(formData.get("text") ?? "").trim() || null;
  if (!text && !content && !flowId) throw new Error("A mensagem não pode ficar vazia.");

  const rawTag = String(formData.get("tag") ?? "").trim();
  const tag = rawTag ? parseMessageTag(rawTag) : undefined;
  if (rawTag && !tag) throw new Error(`Tag de mensagem desconhecida: ${rawTag}`);

  const filterTagIds = formData.getAll("tagIds").map(String).filter(Boolean);
  const segmentId = String(formData.get("segmentId") ?? "").trim() || null;

  // The input is a wall-clock time in the owner's zone, not the server's.
  const raw = String(formData.get("scheduledAt") ?? "").trim();
  let scheduledAt: Date | null = null;
  if (raw) {
    scheduledAt = parseLocalDateTime(raw, timeZone);
    if (!scheduledAt) throw new Error("Data de agendamento inválida.");
    if (scheduledAt.getTime() <= now.getTime()) {
      throw new Error("O agendamento precisa ser no futuro.");
    }
  }

  return { name, text, content, flowId, tag: tag ?? null, filterTagIds, segmentId, scheduledAt };
}

import { accountTimeZone, parseLocalDateTime } from "./timezone";

/**
 * What the broadcast form posts, validated. Kept apart from the server
 * action so the rules can be tested without Next's action runtime.
 */

export type BroadcastDraft = {
  name: string;
  text: string;
  filterTagIds: string[];
  /** Instant to send at, or null to send as soon as it is queued. */
  scheduledAt: Date | null;
};

export function parseBroadcastForm(
  formData: FormData,
  opts: { now?: Date; timeZone?: string } = {},
): BroadcastDraft {
  const now = opts.now ?? new Date();
  const timeZone = opts.timeZone ?? accountTimeZone();

  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || "Disparo sem nome";
  const text = String(formData.get("text") ?? "").trim();
  if (!text) throw new Error("A mensagem não pode ficar vazia.");

  const filterTagIds = formData.getAll("tagIds").map(String).filter(Boolean);

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

  return { name, text, filterTagIds, scheduledAt };
}

/**
 * Meta's 24-hour messaging window.
 *
 * Inside 24h of the contact's last inbound message we may send freely.
 * Outside it, a standard message is rejected by the Graph API (error 10,
 * subcode 2534022). The only escapes are message tags — and for Instagram
 * the ONLY one is HUMAN_AGENT, which extends to 7 days but requires the
 * human_agent permission and a real person in the loop.
 *
 * We enforce this before hitting the API so a broadcast doesn't burn
 * thousands of calls to collect thousands of identical errors.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * HUMAN_AGENT is the only tag Instagram supports. ACCOUNT_UPDATE and
 * POST_PURCHASE_UPDATE are Messenger tags: they used to be listed here and
 * offered in the composer, but canSend never honoured them, so every
 * recipient outside the 24h window failed with a message telling the
 * operator to use a tag they had already chosen.
 */
export type MessageTag = "HUMAN_AGENT";
export const MESSAGE_TAGS: readonly MessageTag[] = ["HUMAN_AGENT"];

/** Human-readable name for the picker. */
export const MESSAGE_TAG_LABELS: Record<MessageTag, string> = {
  HUMAN_AGENT: "Atendimento humano (7 dias)",
};

/** A stored/posted tag string, or undefined when it is not one we know. */
export function parseMessageTag(raw: string | null | undefined): MessageTag | undefined {
  return MESSAGE_TAGS.find((t) => t === raw);
}

export type SendDecision = { allowed: true; tag?: MessageTag } | { allowed: false; reason: string };

/**
 * Decide whether we may message a contact right now.
 *
 * `now` is injectable so tests don't depend on wall-clock time.
 */
export function canSend(
  lastInboundAt: Date | null,
  opts: { tag?: MessageTag; now?: Date } = {},
): SendDecision {
  const now = opts.now ?? new Date();

  if (!lastInboundAt) {
    return {
      allowed: false,
      reason: "Contact has never sent us a message. Instagram forbids initiating a conversation.",
    };
  }

  const elapsed = now.getTime() - lastInboundAt.getTime();

  if (elapsed <= WINDOW_MS) return { allowed: true };

  if (opts.tag === "HUMAN_AGENT") {
    if (elapsed <= HUMAN_AGENT_WINDOW_MS) {
      return { allowed: true, tag: "HUMAN_AGENT" };
    }
    return {
      allowed: false,
      reason: `Outside the 7-day HUMAN_AGENT window (last inbound ${formatElapsed(elapsed)} ago).`,
    };
  }

  return {
    allowed: false,
    reason: `Outside the 24h messaging window (last inbound ${formatElapsed(elapsed)} ago). Use a message tag or wait for the contact to write again.`,
  };
}

/** Milliseconds until the window shuts, or 0 if already closed. */
export function windowRemainingMs(lastInboundAt: Date | null, now = new Date()): number {
  if (!lastInboundAt) return 0;
  return Math.max(0, WINDOW_MS - (now.getTime() - lastInboundAt.getTime()));
}

function formatElapsed(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

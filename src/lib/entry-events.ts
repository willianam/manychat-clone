/**
 * Parsing for the entry points that arrive inside the `messages` webhook
 * field but are not ordinary DMs: story replies, story mentions, and ig.me
 * ref links.
 *
 * Kept pure and separate from the route handler so the shapes can be tested
 * against real captured payloads without a database.
 *
 * Payload shapes verified against
 * developers.facebook.com/docs/messenger-platform/instagram/features/webhook
 * (Instagram messaging webhook reference, v26.0):
 *
 *   story reply    message.reply_to.story = { id, url }
 *   story mention  message.attachments[] = [{ type: "story_mention",
 *                                             payload: { url } }]
 *   ref link       referral = { ref, source, type: "OPEN_THREAD" }
 *                  and, on a brand-new thread, message.referral with the
 *                  same shape (Meta folds it into the first message rather
 *                  than sending a standalone referral event).
 */

/** Anything the webhook can hand us for one messaging event. */
export type MessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    reply_to?: { story?: { id?: string; url?: string }; mid?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
    referral?: Referral;
  };
  postback?: { mid?: string; title?: string; payload?: string; referral?: Referral };
  referral?: Referral;
};

export type Referral = {
  ref?: string;
  source?: string;
  type?: string;
};

/** A story reply: the user answered one of our stories in the DM. */
export type StoryReplyEvent = {
  kind: "story_reply";
  igScopedId: string;
  mid?: string;
  storyId: string;
  storyUrl?: string;
  /** The user's reply text. Always present — a reply with no text is a mention. */
  text: string;
};

/** A story mention: the user put us in *their* story. */
export type StoryMentionEvent = {
  kind: "story_mention";
  igScopedId: string;
  mid?: string;
  /** CDN url of the story we were mentioned in. Expires; treat as ephemeral. */
  storyUrl?: string;
  /** Mentions usually carry no text, but Meta may include a caption. */
  text?: string;
};

/**
 * A story reply, if this event is one.
 *
 * The discriminator is `reply_to.story`, not the presence of an attachment:
 * a reply to a story is a normal text message that happens to quote one.
 * Echoes are ours, never an entry point.
 */
export function parseStoryReply(event: MessagingEvent): StoryReplyEvent | null {
  const msg = event.message;
  if (!msg || msg.is_echo) return null;

  const story = msg.reply_to?.story;
  const storyId = story?.id;
  if (!storyId) return null;

  // A quoted story with no text is not something a keyword can match, and
  // Meta sends exactly that when the user reacts with only a sticker.
  const text = msg.text?.trim();
  if (!text) return null;

  return {
    kind: "story_reply",
    igScopedId: event.sender?.id ?? "",
    mid: msg.mid,
    storyId,
    storyUrl: story?.url,
    text,
  };
}

/**
 * A story mention, if this event is one.
 *
 * Meta delivers it as an attachment of type "story_mention" on an otherwise
 * empty message. Note it is NOT a reply_to.story event — the two never
 * co-occur, so ordering between the two parsers does not matter.
 */
export function parseStoryMention(event: MessagingEvent): StoryMentionEvent | null {
  const msg = event.message;
  if (!msg || msg.is_echo) return null;

  const mention = msg.attachments?.find((a) => a?.type === "story_mention");
  if (!mention) return null;

  return {
    kind: "story_mention",
    igScopedId: event.sender?.id ?? "",
    mid: msg.mid,
    storyUrl: mention.payload?.url,
    text: msg.text?.trim() || undefined,
  };
}

/**
 * The ref code from an ig.me link, wherever Meta chose to put it.
 *
 * Three carriers, all real:
 *   - `referral` on its own event, for an existing conversation;
 *   - `message.referral`, folded into the first message of a NEW thread;
 *   - `postback.referral`, when the thread opens on the Get Started button.
 *
 * Returns null for a referral with no ref (an ig.me link with no ?ref=).
 */
export function parseReferral(event: MessagingEvent): { ref: string; source?: string } | null {
  const referral = event.referral ?? event.message?.referral ?? event.postback?.referral;
  const ref = referral?.ref?.trim();
  if (!ref) return null;
  return { ref, source: referral?.source };
}

/**
 * Normalize a ref code for storage and lookup.
 *
 * Meta URL-decodes ?ref= before echoing it, but casing survives the round
 * trip — and a link typed by hand rarely matches the case it was created in.
 * Lowercasing both sides makes `?ref=Promo` and `?ref=promo` the same link.
 */
export function normalizeRefCode(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Characters Meta accepts in a ref, per the ig.me link spec. */
const REF_ALLOWED = /^[a-z0-9_.\-+]+$/;

/** Longest ref Meta will echo back on an ig.me link. */
export const REF_CODE_MAX = 250;

/**
 * Validate a ref code we are about to hand a user as a link.
 *
 * Meta silently drops a ref it cannot parse, which surfaces as "the link
 * just opens a normal DM" — a bug with no error message anywhere. Rejecting
 * at creation is the only place this is visible.
 */
export function validateRefCode(
  raw: string,
): { ok: true; code: string } | { ok: false; error: string } {
  const code = normalizeRefCode(raw);
  if (!code) return { ok: false, error: "Informe um código para o link." };
  if (code.length > REF_CODE_MAX) {
    return { ok: false, error: `O código pode ter no máximo ${REF_CODE_MAX} caracteres.` };
  }
  if (!REF_ALLOWED.test(code)) {
    return {
      ok: false,
      error: "Use apenas letras, números, ponto, hífen, underline ou +.",
    };
  }
  return { ok: true, code };
}

/** A random, pronounceable-enough ref code. Ambiguous glyphs are excluded. */
export function generateRefCode(length = 8): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  // Available in Node 18+ and the Edge runtime alike.
  globalThis.crypto.getRandomValues(buf);
  return buf;
}

/** The shareable link for a code. `username` is the IG handle, no @. */
export function refLinkUrl(username: string, code: string): string {
  return `https://ig.me/m/${username.replace(/^@/, "")}?ref=${encodeURIComponent(code)}`;
}

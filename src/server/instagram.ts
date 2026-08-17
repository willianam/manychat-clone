import type { PrismaClient } from "@prisma/client";
import { canSend, type MessageTag } from "../lib/messaging-window";

/**
 * Instagram API with Instagram Login (graph.instagram.com).
 *
 * This is the newer variant, which does NOT require a linked Facebook Page.
 * It differs from the Facebook-login flow in three ways that matter here:
 *
 *   host    graph.instagram.com          (not graph.facebook.com)
 *   token   Instagram User Access Token  (not a Page Access Token)
 *   reply   POST /me/messages with       (not /{comment-id}/private_replies,
 *           recipient:{comment_id}        which only exists on the FB-login flow)
 *
 * Endpoints verified against developers.facebook.com/docs/instagram-platform,
 * v26.0.
 */

const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? "v26.0";
const BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

/** The IG professional account id, or "me" — the API accepts both. */
const SELF = process.env.IG_USER_ID ?? "me";

/**
 * Master switch for typing indicators and read receipts.
 *
 * Each sender action costs one extra API call on a webhook that must finish
 * inside 15s, so it has to be possible to turn the whole thing off without a
 * deploy. `SENDER_ACTIONS=off` disables it; anything else (including unset)
 * leaves it on, since the perception win is the point of the feature.
 */
export const SENDER_ACTIONS_ENABLED =
  (process.env.SENDER_ACTIONS ?? "on").toLowerCase() !== "off";

export type SenderAction = "typing_on" | "typing_off" | "mark_seen";

/**
 * Fire a sender action: the typing bubble, or the blue "seen" mark.
 *
 * Verified against developers.facebook.com/docs/instagram-platform —
 * `recipient` and `sender_action` are TOP-LEVEL keys, siblings of each other,
 * with no `message` key at all:
 *
 *   {"recipient":{"id":"<IGSID>"},"sender_action":"typing_on"}
 *
 * Three properties make this safe to call from the webhook path:
 *
 *  - **Never throws.** A failed typing bubble must not abort the reply the
 *    contact is actually waiting for. Failures are swallowed and logged.
 *  - **No Message row.** These are not messages; persisting them would put
 *    noise rows in the inbox.
 *  - **No messaging-window check.** `mark_seen` acknowledges an inbound
 *    message, so it is legal exactly when there is something to acknowledge,
 *    and the window rules apply to sends, not acknowledgements.
 *
 * The caller passes the IGSID directly rather than a contact id, so this can
 * run before any Contact row exists — the whole point of `mark_seen` is that
 * it lands immediately, not after a profile lookup.
 */
export async function sendSenderAction(
  igScopedId: string,
  action: SenderAction,
): Promise<void> {
  if (!SENDER_ACTIONS_ENABLED || !igScopedId) return;

  try {
    const res = await fetch(`${BASE}/${SELF}/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        recipient: { id: igScopedId },
        sender_action: action,
      }),
    });
    if (!res.ok) {
      console.warn(`[instagram] sender_action ${action} failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[instagram] sender_action ${action} failed:`, err);
  }
}

/** `sendSenderAction` for a contact we already have a row for. */
export async function sendSenderActionToContact(
  db: PrismaClient,
  contactId: string,
  action: SenderAction,
): Promise<void> {
  if (!SENDER_ACTIONS_ENABLED) return;
  const contact = await db.contact.findUnique({ where: { id: contactId } });
  if (contact) await sendSenderAction(contact.igScopedId, action);
}

export class SendBlocked extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "SendBlocked";
  }
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${requireEnv("IG_ACCESS_TOKEN")}`,
  };
}

/** Shorthand for the common case: a plain text DM. */
export async function sendText(
  db: PrismaClient,
  contactId: string,
  text: string,
  opts: { tag?: MessageTag } = {},
): Promise<void> {
  return sendMessage(db, contactId, { text }, { ...opts, preview: text });
}

/**
 * Send any message payload, enforcing the messaging window before we spend
 * an API call.
 *
 * `preview` is what shows in the inbox for non-text payloads — a carousel
 * has no text of its own, and an empty inbox row reads as a bug.
 *
 * Every attempt is persisted as a Message row — including failures — so the
 * inbox reflects reality rather than only what succeeded.
 */
export async function sendMessage(
  db: PrismaClient,
  contactId: string,
  payload: Record<string, unknown>,
  opts: { tag?: MessageTag; preview?: string } = {},
): Promise<void> {
  const text = opts.preview ?? "";
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });

  const decision = canSend(contact.lastInboundAt, { tag: opts.tag });
  if (!decision.allowed) {
    await db.message.create({
      data: { contactId, direction: "OUTBOUND", text, status: "FAILED", error: decision.reason },
    });
    throw new SendBlocked(decision.reason);
  }

  const message = await db.message.create({
    data: {
      contactId,
      direction: "OUTBOUND",
      text,
      status: "PENDING",
      payload: payload as never,
    },
  });

  try {
    const res = await fetch(`${BASE}/${SELF}/messages`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        recipient: { id: contact.igScopedId },
        message: payload,
        ...(decision.tag ? { messaging_type: "MESSAGE_TAG", tag: decision.tag } : {}),
      }),
    });

    const body = (await res.json()) as { message_id?: string; error?: { message: string } };

    if (!res.ok) {
      await db.message.update({
        where: { id: message.id },
        data: { status: "FAILED", error: body.error?.message ?? `HTTP ${res.status}` },
      });
      throw new Error(body.error?.message ?? `Instagram API returned ${res.status}`);
    }

    await db.message.update({
      where: { id: message.id },
      data: { status: "SENT", externalId: body.message_id },
    });
  } catch (err) {
    await db.message.update({
      where: { id: message.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/**
 * Reply privately to a comment — the comment-to-DM primitive.
 *
 * On this API the private reply is an ordinary message whose recipient is a
 * comment_id rather than a user id. One reply per comment, allowed up to 7
 * days after the comment (and only during the broadcast for IG Live).
 *
 * Returns the Instagram-scoped id of the person who commented, which is what
 * the caller needs to create the Contact row.
 */
export async function sendPrivateReply(
  commentId: string,
  text: string,
): Promise<{ recipientId: string; messageId: string }> {
  const res = await fetch(`${BASE}/${SELF}/messages`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text },
    }),
  });

  const body = (await res.json()) as {
    recipient_id?: string;
    message_id?: string;
    error?: { message: string };
  };
  if (!res.ok) throw new Error(body.error?.message ?? `Instagram API returned ${res.status}`);

  return { recipientId: body.recipient_id ?? "", messageId: body.message_id ?? "" };
}

/**
 * Public profile fields for a contact. Best-effort: failure is not fatal.
 *
 * This API exposes `name` and `username`; the avatar comes back as
 * `profile_picture_url` rather than `profile_pic`.
 */
export async function fetchProfile(
  igScopedId: string,
): Promise<{ name?: string; username?: string; profilePic?: string }> {
  try {
    const res = await fetch(
      `${BASE}/${igScopedId}?fields=name,username,profile_picture_url`,
      { headers: { Authorization: `Bearer ${requireEnv("IG_ACCESS_TOKEN")}` } },
    );
    if (!res.ok) return {};
    const b = (await res.json()) as {
      name?: string;
      username?: string;
      profile_picture_url?: string;
    };
    return { name: b.name, username: b.username, profilePic: b.profile_picture_url };
  } catch {
    return {};
  }
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

import type { PrismaClient } from "@prisma/client";
import { canSend, type MessageTag } from "../lib/messaging-window";
import { db as defaultDb } from "./db";
import { getAccessToken } from "./token-refresh";

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
 * Three properties make this safe to call from the reply path:
 *
 *  - **Never throws.** A failed typing bubble must not abort the reply the
 *    contact is actually waiting for. Failures are swallowed and logged.
 *  - **No Message row.** These are not messages; persisting them would put
 *    noise rows in the inbox.
 *  - **No messaging-window check.** `mark_seen` acknowledges an inbound
 *    message, so it is legal exactly when there is something to acknowledge,
 *    and the window rules apply to sends, not acknowledgements.
 *
 * `mark_seen` is NOT sent by the webhook for every inbound DM. The flow-runner
 * sends it right before the first reply of a flow run (see `advance`), so a
 * message no flow answers stays unread for the account owner in the
 * Instagram app. Both actions therefore go through `sendSenderActionToContact`
 * in practice; this IGSID-level function is the primitive underneath it.
 */
export async function sendSenderAction(
  igScopedId: string,
  action: SenderAction,
): Promise<void> {
  if (!SENDER_ACTIONS_ENABLED || !igScopedId) return;

  try {
    const res = await fetch(`${BASE}/${SELF}/messages`, {
      method: "POST",
      headers: await authHeaders(defaultDb),
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

/**
 * The token comes from the IgCredential row (seeded from IG_ACCESS_TOKEN),
 * so a refreshed token is picked up without a deploy — see token-refresh.ts.
 */
async function authHeaders(db: PrismaClient): Promise<Record<string, string>> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await getAccessToken(db)}`,
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
      headers: await authHeaders(db),
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
    headers: await authHeaders(defaultDb),
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
 * The avatar field on THIS node is `profile_pic`. `profile_picture_url` is
 * the name it carries on /me, and asking for it here fails the whole call —
 * Graph rejects the request rather than omitting the unknown field, so name
 * and username came back empty too. Every contact created before this fix
 * has no name for that reason.
 */
export async function fetchProfile(
  igScopedId: string,
): Promise<{ name?: string; username?: string; profilePic?: string }> {
  try {
    const res = await fetch(
      `${BASE}/${igScopedId}?fields=name,username,profile_pic`,
      { headers: { Authorization: `Bearer ${await getAccessToken(defaultDb)}` } },
    );
    if (!res.ok) return {};
    const b = (await res.json()) as {
      name?: string;
      username?: string;
      profile_pic?: string;
    };
    return { name: b.name, username: b.username, profilePic: b.profile_pic };
  } catch {
    return {};
  }
}

/**
 * Upload a file to Meta and get a reusable attachment id.
 *
 * This is what removes the "host it somewhere first" step: the file goes
 * straight to Meta, and the returned id can be sent to any number of
 * contacts without re-uploading. Verified against v26.0 —
 * POST /me/message_attachments, multipart, `filedata` + a `message` field
 * describing the attachment.
 *
 * Limits are Meta's: 8 MB for images, 25 MB for audio, video and files.
 */
export async function uploadAttachment(
  file: Blob,
  type: "image" | "audio" | "video" | "file",
): Promise<string> {
  const form = new FormData();
  form.append(
    "message",
    JSON.stringify({ attachment: { type, payload: { is_reusable: true } } }),
  );
  form.append("filedata", file);

  const res = await fetch(`${BASE}/${SELF}/message_attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getAccessToken(defaultDb)}` },
    body: form,
  });

  const body = (await res.json()) as {
    attachment_id?: string;
    error?: { message: string };
  };
  if (!res.ok || !body.attachment_id) {
    throw new Error(body.error?.message ?? `Falha no upload (HTTP ${res.status})`);
  }
  return body.attachment_id;
}

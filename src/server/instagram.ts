import type { PrismaClient } from "@prisma/client";
import { canSend, type MessageTag } from "../lib/messaging-window";

const GRAPH_VERSION = process.env.GRAPH_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class SendBlocked extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "SendBlocked";
  }
}

/**
 * Send a DM, enforcing the messaging window before we spend an API call.
 *
 * Every attempt is persisted as a Message row — including failures — so the
 * inbox reflects reality rather than only what succeeded.
 */
export async function sendText(
  db: PrismaClient,
  contactId: string,
  text: string,
  opts: { tag?: MessageTag } = {},
): Promise<void> {
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });

  const decision = canSend(contact.lastInboundAt, { tag: opts.tag });
  if (!decision.allowed) {
    await db.message.create({
      data: { contactId, direction: "OUTBOUND", text, status: "FAILED", error: decision.reason },
    });
    throw new SendBlocked(decision.reason);
  }

  const message = await db.message.create({
    data: { contactId, direction: "OUTBOUND", text, status: "PENDING" },
  });

  try {
    const res = await fetch(`${BASE}/me/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requireEnv("IG_PAGE_ACCESS_TOKEN")}`,
      },
      body: JSON.stringify({
        recipient: { id: contact.igScopedId },
        message: { text },
        ...(decision.tag ? { messaging_type: "MESSAGE_TAG", tag: decision.tag } : {}),
      }),
    });

    const body = (await res.json()) as { message_id?: string; error?: { message: string } };

    if (!res.ok) {
      await db.message.update({
        where: { id: message.id },
        data: { status: "FAILED", error: body.error?.message ?? `HTTP ${res.status}` },
      });
      throw new Error(body.error?.message ?? `Graph API returned ${res.status}`);
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
 * Reply privately to a comment. This is the comment-to-DM primitive: Meta
 * allows one private reply per comment, and it opens a 24h window even
 * though the user never DMed us.
 */
export async function sendPrivateReply(commentId: string, text: string): Promise<string> {
  const res = await fetch(`${BASE}/${commentId}/private_replies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("IG_PAGE_ACCESS_TOKEN")}`,
    },
    body: JSON.stringify({ message: text }),
  });

  const body = (await res.json()) as { id?: string; error?: { message: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `Graph API returned ${res.status}`);
  return body.id ?? "";
}

/** Public profile fields for a contact. Best-effort: failure is not fatal. */
export async function fetchProfile(
  igScopedId: string,
): Promise<{ name?: string; username?: string; profilePic?: string }> {
  try {
    const res = await fetch(
      `${BASE}/${igScopedId}?fields=name,username,profile_pic&access_token=${requireEnv("IG_PAGE_ACCESS_TOKEN")}`,
    );
    if (!res.ok) return {};
    const b = (await res.json()) as { name?: string; username?: string; profile_pic?: string };
    return { name: b.name, username: b.username, profilePic: b.profile_pic };
  } catch {
    return {};
  }
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

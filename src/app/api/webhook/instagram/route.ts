import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../server/db";
import { verifySignature, verifyChallenge } from "../../../../lib/verify-signature";
import { handleInboundMessage, handleComment } from "../../../../server/trigger-dispatch";
import { fetchProfile } from "../../../../server/instagram";
import { tickDelayedSessions, runBroadcast } from "../../../../server/broadcast-worker";

export const runtime = "nodejs"; // crypto + Prisma need Node, not Edge
export const dynamic = "force-dynamic";

/** Meta's subscription handshake. */
export async function GET(req: NextRequest) {
  const challenge = verifyChallenge(
    req.nextUrl.searchParams,
    process.env.IG_VERIFY_TOKEN ?? "",
  );
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(req: NextRequest) {
  // Raw body first — parsing then re-serializing breaks the HMAC.
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), process.env.IG_APP_SECRET ?? "")) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  // Ack immediately. Meta retries anything slower than ~20s, which would
  // duplicate work; the dedup table below is the second line of defense.
  const payload = JSON.parse(raw) as MetaWebhook;
  processPayload(payload)
    .then(() => drainDueWork())
    .catch((err) => console.error("[webhook] processing failed:", err));

  return NextResponse.json({ received: true });
}

async function processPayload(payload: MetaWebhook): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.message?.text || event.message.is_echo) continue;

      const mid = event.message.mid;
      if (mid && (await seen(mid, "message", event))) continue;

      const igsid = event.sender.id;
      const profile = await fetchProfile(igsid);

      const contact = await db.contact.upsert({
        where: { igScopedId: igsid },
        create: { igScopedId: igsid, lastInboundAt: new Date(), ...profile },
        update: { lastInboundAt: new Date(), ...profile },
      });

      await db.message.create({
        data: {
          contactId: contact.id,
          direction: "INBOUND",
          text: event.message.text,
          status: "DELIVERED",
          externalId: mid,
        },
      });

      await handleInboundMessage(db, contact.id, event.message.text);
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const v = change.value;
      if (!v?.id || !v.text) continue;
      if (await seen(v.id, "comment", v)) continue;

      await handleComment(db, {
        commentId: v.id,
        mediaId: v.media?.id ?? "",
        text: v.text,
        igScopedId: v.from?.id ?? "",
        username: v.from?.username,
      });
    }
  }
}

/**
 * Piggyback the background work onto webhook traffic.
 *
 * Vercel's Hobby plan allows only ONE cron run per day, so the minute-by-
 * minute worker isn't available. Every inbound webhook is therefore also a
 * chance to resume sessions whose delay elapsed and to push a queued
 * broadcast forward. In practice a bot that receives messages drains its
 * own backlog; the daily cron is the floor for a completely idle account.
 *
 * Failures here must never affect the webhook response — it already
 * returned 200 by the time this runs.
 */
async function drainDueWork(): Promise<void> {
  try {
    await tickDelayedSessions(db);

    const queued = await db.broadcast.findFirst({
      where: {
        status: { in: ["QUEUED", "SENDING"] },
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
    });
    if (queued) await runBroadcast(db, queued.id);
  } catch (err) {
    console.error("[webhook] background drain failed:", err);
  }
}

/** True if we already handled this delivery. Meta replays generously. */
async function seen(externalId: string, kind: string, raw: unknown): Promise<boolean> {
  try {
    await db.webhookEvent.create({
      data: { externalId, kind, raw: raw as object },
    });
    return false;
  } catch {
    return true; // unique violation == duplicate
  }
}

type MetaWebhook = {
  entry?: Array<{
    messaging?: Array<{
      sender: { id: string };
      message?: { mid?: string; text?: string; is_echo?: boolean };
    }>;
    changes?: Array<{
      field: string;
      value?: {
        id?: string;
        text?: string;
        media?: { id?: string };
        from?: { id?: string; username?: string };
      };
    }>;
  }>;
};

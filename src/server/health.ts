import type { PrismaClient } from "@prisma/client";
import { tokenStatus } from "./token-refresh";
import { errorSummary } from "./error-events";

/**
 * What /api/health reports. Public, so nothing here is a secret: token
 * *status* (days left, whether the last refresh failed), never the token;
 * error counts and scopes, never stacks or payloads.
 */
export type Health = {
  ok: boolean;
  db: "ok" | "down";
  token: {
    configured: boolean;
    daysLeft: number | null;
    refreshedAt: string | null;
    needsAttention: boolean;
    /** Whether the last refresh failed. The message itself stays private. */
    lastRefreshFailed: boolean;
  };
  /** Last message we tried to send through the Graph API. */
  lastMetaCall: { at: string; ok: boolean } | null;
  errors24h: { count: number; lastScope: string | null; lastAt: string | null };
  checkedAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function checkHealth(db: PrismaClient, now = new Date()): Promise<Health> {
  let dbOk = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }

  const unavailable: Health = {
    ok: false,
    db: "down",
    token: {
      configured: false,
      daysLeft: null,
      refreshedAt: null,
      needsAttention: true,
      lastRefreshFailed: false,
    },
    lastMetaCall: null,
    errors24h: { count: 0, lastScope: null, lastAt: null },
    checkedAt: now.toISOString(),
  };
  if (!dbOk) return unavailable;

  const [token, lastSend, errors] = await Promise.all([
    tokenStatus(db, now),
    db.message.findFirst({
      where: { direction: "OUTBOUND", status: { not: "PENDING" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, status: true },
    }),
    errorSummary(db, new Date(now.getTime() - DAY_MS)),
  ]);

  return {
    ok: token.configured && !token.needsAttention,
    db: "ok",
    token: {
      configured: token.configured,
      daysLeft: token.daysLeft,
      refreshedAt: token.refreshedAt?.toISOString() ?? null,
      needsAttention: token.needsAttention,
      lastRefreshFailed: token.lastError !== null,
    },
    lastMetaCall: lastSend
      ? { at: lastSend.createdAt.toISOString(), ok: lastSend.status !== "FAILED" }
      : null,
    errors24h: {
      count: errors.count,
      lastScope: errors.last?.scope ?? null,
      lastAt: errors.last?.at.toISOString() ?? null,
    },
    checkedAt: now.toISOString(),
  };
}

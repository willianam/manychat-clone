import type { PrismaClient } from "@prisma/client";

/**
 * The Instagram access token, and keeping it alive.
 *
 * A long-lived Instagram User Access Token lasts ~60 days and then the bot
 * dies in silence: every send fails with an auth error and nothing on the
 * panel says why. Meta allows refreshing a token that is at least 24 hours
 * old and not yet expired, which resets the 60-day clock. So the token lives
 * in the database (one row, id "default"), the worker tick refreshes it when
 * it is close to expiring, and the panel warns when that stops working.
 *
 * The env var remains the way the token gets in. The row is seeded from
 * IG_ACCESS_TOKEN the first time a token is needed, and a *changed* env value
 * is adopted again whenever the row has never been refreshed or its last
 * refresh failed — that is what a manual rotation looks like. After a
 * successful refresh the row is newer than the env and the env is ignored.
 *
 * Verified against developers.facebook.com/docs/instagram-platform/reference/
 * refresh_access_token (v26.0): GET graph.instagram.com/refresh_access_token
 * with grant_type=ig_refresh_token, response {access_token, token_type,
 * expires_in} where expires_in is in seconds.
 */

const CREDENTIAL_ID = "default";
const REFRESH_URL = "https://graph.instagram.com/refresh_access_token";

/** How long a token read from the database is reused before re-reading. */
const CACHE_TTL_MS = 60 * 1000;
/** Refresh once fewer than this many days remain. */
export const REFRESH_AHEAD_DAYS = 10;
/** Warn the owner once fewer than this many days remain. */
export const WARN_AHEAD_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Credential = {
  accessToken: string;
  expiresAt: Date | null;
  refreshedAt: Date | null;
  lastError: string | null;
};

let cache: { token: string; readAt: number } | null = null;

/** Forget the cached token. Called after a refresh, and by tests. */
export function invalidateTokenCache(): void {
  cache = null;
}

/**
 * The stored credential, creating it from the env on first use.
 *
 * Returns null when there is neither a row nor an env var — the app is
 * simply not connected to Instagram yet, which is a normal state before the
 * Meta review is done.
 */
async function loadCredential(db: PrismaClient): Promise<Credential | null> {
  const fromEnv = process.env.IG_ACCESS_TOKEN;
  const row = await db.igCredential.findUnique({ where: { id: CREDENTIAL_ID } });

  if (!row) {
    if (!fromEnv) return null;
    // upsert, not create: two cold serverless invocations may seed at once.
    return db.igCredential.upsert({
      where: { id: CREDENTIAL_ID },
      create: { id: CREDENTIAL_ID, accessToken: fromEnv },
      update: {},
    });
  }

  const rotatedManually =
    fromEnv && fromEnv !== row.accessToken && (row.refreshedAt === null || row.lastError !== null);
  if (rotatedManually) {
    return db.igCredential.update({
      where: { id: CREDENTIAL_ID },
      data: { accessToken: fromEnv, expiresAt: null, refreshedAt: null, lastError: null },
    });
  }

  return row;
}

/**
 * The token every Graph API call should use.
 *
 * Database first, env as the fallback — a broken database must not stop the
 * bot from answering when the env still has a working token. Throws the same
 * error the old env-only code did when there is no token anywhere, so the
 * callers' "not configured" handling is unchanged.
 */
export async function getAccessToken(db: PrismaClient, now = Date.now()): Promise<string> {
  if (cache && now - cache.readAt < CACHE_TTL_MS) return cache.token;

  let token: string | undefined;
  try {
    token = (await loadCredential(db))?.accessToken;
  } catch (err) {
    console.warn("[token] could not read IgCredential, using the env token:", err);
    token = process.env.IG_ACCESS_TOKEN;
  }

  if (!token) throw new Error("Missing required env var IG_ACCESS_TOKEN");
  cache = { token, readAt: now };
  return token;
}

export type RefreshOutcome =
  | { action: "unconfigured" }
  | { action: "skipped"; expiresAt: Date | null }
  | { action: "refreshed"; expiresAt: Date }
  | { action: "failed"; error: string };

/**
 * Refresh the token if it is due. Safe to call on every tick.
 *
 * Due means: fewer than REFRESH_AHEAD_DAYS left, or an unknown expiry (a
 * token straight from the env). The unknown case refreshes eagerly on
 * purpose: Meta's answer carries the real `expires_in`, and guessing "60
 * days from now" for a token that may already be 50 days old is precisely
 * the silent death this module exists to prevent. The one cost is that a
 * token younger than 24h is refused by Meta once; that failure lands in
 * `lastError`, the next tick retries, and the panel shows it meanwhile.
 *
 * Never throws: a refresh failure is recorded on the row and must not stop
 * the rest of the tick (delays, broadcasts) from running.
 *
 * `force` skips the due check — the settings page's "renovar agora". Meta
 * still refuses a token younger than 24h; that lands in `lastError` like
 * any other failure.
 */
export async function maybeRefreshToken(
  db: PrismaClient,
  now = new Date(),
  opts: { force?: boolean } = {},
): Promise<RefreshOutcome> {
  let cred: Credential | null;
  try {
    cred = await loadCredential(db);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[token] refresh skipped, could not read IgCredential:", error);
    return { action: "failed", error };
  }
  if (!cred) return { action: "unconfigured" };

  const dueAt = cred.expiresAt ? cred.expiresAt.getTime() - REFRESH_AHEAD_DAYS * DAY_MS : 0;
  if (!opts.force && now.getTime() < dueAt) {
    return { action: "skipped", expiresAt: cred.expiresAt };
  }

  try {
    const url =
      `${REFRESH_URL}?grant_type=ig_refresh_token` +
      `&access_token=${encodeURIComponent(cred.accessToken)}`;
    const res = await fetch(url);
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!res.ok || !body.access_token || typeof body.expires_in !== "number") {
      throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    }

    const expiresAt = new Date(now.getTime() + body.expires_in * 1000);
    await db.igCredential.update({
      where: { id: CREDENTIAL_ID },
      data: { accessToken: body.access_token, expiresAt, refreshedAt: now, lastError: null },
    });
    invalidateTokenCache();
    return { action: "refreshed", expiresAt };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[token] refresh failed: ${error}`);
    await db.igCredential
      .update({ where: { id: CREDENTIAL_ID }, data: { lastError: error } })
      .catch(() => {}); // the failure is already logged; a second one adds nothing
    return { action: "failed", error };
  }
}

export type TokenStatus = {
  /** False when no token exists anywhere — Instagram is not connected. */
  configured: boolean;
  expiresAt: Date | null;
  refreshedAt: Date | null;
  lastError: string | null;
  /** Whole days until expiry, rounded down. Null when unknown. */
  daysLeft: number | null;
  /** Expiring within WARN_AHEAD_DAYS, or the last refresh failed. */
  needsAttention: boolean;
};

/** What the settings page shows about the token. Never throws. */
export async function tokenStatus(db: PrismaClient, now = new Date()): Promise<TokenStatus> {
  let cred: Credential | null = null;
  try {
    cred = await loadCredential(db);
  } catch (err) {
    console.warn("[token] status unavailable:", err);
  }

  if (!cred) {
    return {
      configured: false,
      expiresAt: null,
      refreshedAt: null,
      lastError: null,
      daysLeft: null,
      needsAttention: false,
    };
  }

  const daysLeft = cred.expiresAt
    ? Math.floor((cred.expiresAt.getTime() - now.getTime()) / DAY_MS)
    : null;

  return {
    configured: true,
    expiresAt: cred.expiresAt,
    refreshedAt: cred.refreshedAt,
    lastError: cred.lastError,
    daysLeft,
    needsAttention: cred.lastError !== null || (daysLeft !== null && daysLeft < WARN_AHEAD_DAYS),
  };
}

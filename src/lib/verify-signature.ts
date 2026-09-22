import crypto from "node:crypto";

/**
 * Meta signs every webhook POST with HMAC-SHA256 over the RAW body, using
 * the app secret. The header is `x-hub-signature-256: sha256=<hex>`.
 *
 * Two things matter and are easy to get wrong:
 *
 * 1. It must be the raw bytes. If you let a framework JSON.parse the body
 *    and re-serialize it, key order and whitespace shift and the digest
 *    never matches. In the Next.js route we read `await req.text()` first.
 *
 * 2. The comparison must be constant-time. A plain `===` leaks how many
 *    leading bytes were right, which is enough to forge a signature byte
 *    by byte given enough attempts.
 *
 * 3. An empty secret is NOT a secret. HMAC happily accepts "" as a key and
 *    produces a perfectly verifiable digest, so an unset IG_APP_SECRET used
 *    to make every forged body valid. Both functions here reject an empty
 *    secret outright; the route also refuses to serve at all without one.
 */
export function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!appSecret) return false;
  if (!header?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest();

  let received: Buffer;
  try {
    received = Buffer.from(header.slice("sha256=".length), "hex");
  } catch {
    return false;
  }

  // timingSafeEqual throws on length mismatch, so check first.
  if (received.length !== expected.length) return false;

  return crypto.timingSafeEqual(expected, received);
}

/**
 * The GET handshake Meta performs when you first register the webhook URL.
 * Echo back hub.challenge only when the verify token matches the one you
 * typed into the App Dashboard.
 */
export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) return challenge;
  return null;
}

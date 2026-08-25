/**
 * Signed session tokens for the admin panel.
 *
 * The cookie used to BE the password. Anyone who could read it — a browser
 * extension, a shared laptop, a log line — had the password itself, for
 * ever. The cookie is now `<exp>.<hmac>`: an expiry timestamp signed with
 * HMAC-SHA256. It proves a login happened, expires on its own, and reveals
 * nothing about the password.
 *
 * Web Crypto only. The middleware runs on the Edge runtime, where
 * `node:crypto` does not exist; `crypto.subtle` is available there, in Node
 * 20+, and in Vitest, so one implementation serves all three.
 *
 * The secret is AUTH_SECRET, or — so a working deployment keeps working —
 * derived from ADMIN_PASSWORD with a fixed salt. Changing either value logs
 * everyone out, which is the point.
 */

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SALT = "manychat-clone/auth/v1";
const enc = new TextEncoder();

/** The HMAC secret, or null when the panel cannot be unlocked at all. */
export function authSecret(env: Record<string, string | undefined> = process.env): string | null {
  if (env.AUTH_SECRET) return env.AUTH_SECRET;
  if (env.ADMIN_PASSWORD) return `${SALT}:${env.ADMIN_PASSWORD}`;
  return null;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/** `<exp>.<hex hmac of exp>`; `exp` is epoch milliseconds. */
export async function signToken(secret: string, exp: number): Promise<string> {
  const key = await hmacKey(secret, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(exp)));
  return `${exp}.${toHex(new Uint8Array(sig))}`;
}

/**
 * True for a well-formed, unexpired token signed with `secret`.
 *
 * The signature check goes through `crypto.subtle.verify`, which compares
 * inside the primitive in constant time — the Web Crypto counterpart of
 * `timingSafeEqual`, and the reason the hex is never compared with `===`.
 */
export async function verifyToken(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const expStr = token.slice(0, dot);
  const hex = token.slice(dot + 1);
  if (!/^\d{1,15}$/.test(expStr) || !/^[0-9a-f]{64}$/.test(hex)) return false;
  if (Number(expStr) <= now) return false;

  const key = await hmacKey(secret, "verify");
  return crypto.subtle.verify("HMAC", key, fromHex(hex), enc.encode(expStr));
}

/**
 * Constant-time string equality, for the password check itself.
 *
 * Both sides are hashed first so the comparison is always over 32 bytes:
 * neither the length of the submitted password nor how many leading
 * characters were right shows up in the timing.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  // Backed by a plain ArrayBuffer explicitly: BufferSource excludes views
  // over a SharedArrayBuffer, and TS 5.9 tracks that in the type.
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

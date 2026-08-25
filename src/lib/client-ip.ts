/**
 * The IP to key the login rate limiter on.
 *
 * `x-forwarded-for` is a list the client can seed: a request may arrive with
 * `X-Forwarded-For: 1.2.3.4` already set, and every proxy in front of us
 * APPENDS to it. So the leftmost entry is whatever the caller wrote — using
 * it hands out a fresh rate-limit bucket for every random value, defeating
 * the limiter entirely.
 *
 * The rightmost entry is the one our own trusted proxy appended, which the
 * client cannot forge. `x-vercel-forwarded-for` is set by Vercel itself and
 * is not client-appendable, so it wins when present.
 */
export function clientIp(headers: {
  get(name: string): string | null;
}): string {
  const vercel = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel;

  const chain = headers.get("x-forwarded-for");
  if (chain) {
    const hops = chain
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return nearest;
  }

  return "unknown";
}

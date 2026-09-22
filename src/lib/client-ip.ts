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
 * client cannot forge — BUT only if there is a proxy. The Dockerfile serves
 * `npm run start` straight on port 3000; behind nothing, the whole header
 * including its last entry comes from the attacker, who then mints a fresh
 * bucket per attempt and brute-forces the single password unimpeded.
 *
 * So `x-forwarded-for` is honoured only when the deployment says a trusted
 * proxy is in front: `TRUST_PROXY=1`, or Vercel, which sets `VERCEL=1` and
 * `x-vercel-forwarded-for` itself. With no trusted source every request
 * lands in ONE shared bucket, which throttles the whole endpoint instead of
 * nobody — the safe direction for a single-operator panel.
 */
const SHARED_BUCKET = "untrusted";

function proxyIsTrusted(env: NodeJS.ProcessEnv): boolean {
  return env.TRUST_PROXY === "1" || Boolean(env.VERCEL);
}

export function clientIp(
  headers: { get(name: string): string | null },
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Vercel sets this one itself and strips a client-supplied copy, so it is
  // authoritative wherever it appears.
  const vercel = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel;

  if (!proxyIsTrusted(env)) return SHARED_BUCKET;

  const chain = headers.get("x-forwarded-for");
  if (chain) {
    const hops = chain
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return nearest;
  }

  return SHARED_BUCKET;
}

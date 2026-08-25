/**
 * Login throttle: 5 failed attempts per IP, then a 15-minute wait.
 *
 * In memory, on purpose. The panel has one user; the goal is to make a
 * password guess cost minutes instead of milliseconds, not to survive a
 * distributed attack. The map lives per process, so on Vercel each warm
 * instance counts separately and the real ceiling is "5 × instances" —
 * still a wall against a script, and worth zero infrastructure.
 */

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** Above this many tracked IPs, expired entries are swept on the next write. */
const SWEEP_ABOVE = 1000;

type Bucket = { failures: number; resetAt: number };

export class LoginRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly max = LOGIN_MAX_ATTEMPTS,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  /** May this IP try to log in right now? */
  allows(ip: string, now = Date.now()): boolean {
    const b = this.live(ip, now);
    return !b || b.failures < this.max;
  }

  /** A wrong password. Starts the window on the first failure. */
  recordFailure(ip: string, now = Date.now()): void {
    if (this.buckets.size > SWEEP_ABOVE) this.sweep(now);
    const b = this.live(ip, now);
    if (b) b.failures += 1;
    else this.buckets.set(ip, { failures: 1, resetAt: now + this.windowMs });
  }

  /** A correct password clears the slate for that IP. */
  reset(ip: string): void {
    this.buckets.delete(ip);
  }

  private live(ip: string, now: number): Bucket | undefined {
    const b = this.buckets.get(ip);
    if (b && b.resetAt <= now) {
      this.buckets.delete(ip);
      return undefined;
    }
    return b;
  }

  private sweep(now: number): void {
    for (const [ip, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(ip);
  }
}

export const loginRateLimiter = new LoginRateLimiter();

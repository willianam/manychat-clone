/**
 * Wall-clock arithmetic in the account's timezone.
 *
 * The server's clock is UTC on Vercel and whatever the laptop says in dev;
 * neither is where the account owner lives. Anything that reasons about
 * "8am" or "tomorrow" — the delay window, a scheduled broadcast typed into a
 * datetime-local input — has to be computed in ACCOUNT_TIMEZONE, or the
 * flow wakes people at the wrong hour.
 *
 * No library: `Intl.DateTimeFormat` knows every IANA zone and its DST rules,
 * and the two conversions below are all this app needs.
 */

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

/** The IANA zone the owner lives in. Set ACCOUNT_TIMEZONE to override. */
export function accountTimeZone(): string {
  return process.env.ACCOUNT_TIMEZONE || DEFAULT_TIMEZONE;
}

export type WallClock = {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number; // 0–23
  minute: number;
  second: number;
};

/** What a clock on the wall in `timeZone` shows at `date`. */
export function wallClockIn(date: Date, timeZone: string): WallClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return {
    year: p.year!,
    month: p.month!,
    day: p.day!,
    hour: p.hour!,
    minute: p.minute!,
    second: p.second!,
  };
}

/** Milliseconds `timeZone` is ahead of UTC at `date` (negative = behind). */
function offsetAt(date: Date, timeZone: string): number {
  const w = wallClockIn(date, timeZone);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant at which a clock in `timeZone` shows this wall-clock time. */
export function wallClockToDate(w: WallClock, timeZone: string): Date {
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // First pass assumes the offset at the wall time read as UTC; the second
  // re-reads the offset at the answer, which corrects a DST switch between
  // the two.
  const first = wall - offsetAt(new Date(wall), timeZone);
  return new Date(wall - offsetAt(new Date(first), timeZone));
}

/**
 * Parse a `<input type="datetime-local">` value ("2026-08-25T14:30") as a
 * time in `timeZone`. Null for anything else — the browser normally sends
 * exactly this shape, so a mismatch is a bug worth surfacing, not guessing.
 */
export function parseLocalDateTime(input: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  if (!m) return null;
  const date = wallClockToDate(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: Number(m[4]),
      minute: Number(m[5]),
      second: Number(m[6] ?? 0),
    },
    timeZone,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "25/08/2026, 14:30" in the account's zone, for lists and labels. */
export function formatInTimeZone(date: Date, timeZone: string): string {
  return date.toLocaleString("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" });
}

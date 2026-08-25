/**
 * Short pt-BR time strings for lists and counters. Every function takes
 * `now` so components (and tests) render the same string on both ends.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "agora", "5 min", "3 h", "2 d", then a calendar date. */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime();
  if (diff < MIN) return "agora";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** "23h 59min", "45 min", "menos de 1 min". Used by the window counter. */
export function formatDuration(ms: number): string {
  if (ms < MIN) return "menos de 1 min";
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MIN);
  if (hours === 0) return `${minutes} min`;
  return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}

/** "14:32" — the timestamp beside a bubble. */
export function clockTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** "27/08/2026" — day separators in a thread. */
export function calendarDay(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

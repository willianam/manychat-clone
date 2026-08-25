import type { PrismaClient } from "@prisma/client";
import { dateColumn, dayBounds, dayOf, type DayKey } from "./rollup";

/**
 * Read side of the daily aggregates, for the dashboard.
 *
 * Everything here reads DailyStat only — never the source tables — so a
 * year of history costs a few hundred rows, whatever the message volume.
 */

export type SeriesPoint = { date: DayKey; value: number };

export type SeriesQuery = {
  metric: string;
  /** Dimension value (trigger id, flow id). Omit for the global series. */
  key?: string;
  from: DayKey;
  to: DayKey;
};

/** One value per day in [from, to], zero-filled where nothing was rolled up. */
export async function dailySeries(db: PrismaClient, q: SeriesQuery): Promise<SeriesPoint[]> {
  const rows = await db.dailyStat.findMany({
    where: {
      metric: q.metric,
      key: q.key ?? "",
      date: { gte: dateColumn(q.from), lte: dateColumn(q.to) },
    },
    select: { date: true, value: true },
  });

  const byDay = new Map<DayKey, number>();
  for (const r of rows) byDay.set(r.date.toISOString().slice(0, 10), r.value);

  return listDays(q.from, q.to).map((date) => ({ date, value: byDay.get(date) ?? 0 }));
}

/** Sum of a metric over [from, to], split by key. Global metrics come back under "". */
export async function totalsByKey(
  db: PrismaClient,
  metric: string,
  from: DayKey,
  to: DayKey,
): Promise<Record<string, number>> {
  const rows = await db.dailyStat.groupBy({
    by: ["key"],
    where: { metric, date: { gte: dateColumn(from), lte: dateColumn(to) } },
    _sum: { value: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = r._sum.value ?? 0;
  return out;
}

/** The last `days` calendar days ending today, as a [from, to] pair. */
export function lastDays(days: number, now = new Date()): { from: DayKey; to: DayKey } {
  const to = dayOf(now);
  const start = dayBounds(to).start.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
  // Noon on the start day avoids DST edge cases when converting back.
  return { from: dayOf(new Date(start + 12 * 60 * 60 * 1000)), to };
}

/** Every day key from `from` to `to`, inclusive. */
export function listDays(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  const cur = dateColumn(from);
  const end = dateColumn(to).getTime();
  while (cur.getTime() <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

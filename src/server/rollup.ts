import type { PrismaClient } from "@prisma/client";
import { accountTimeZone, wallClockIn, wallClockToDate } from "../lib/timezone";

/**
 * Daily aggregates, recomputed from the source rows.
 *
 * `rollupDay` is idempotent: every metric for the day is counted afresh and
 * upserted, so running it twice — or after a late webhook — converges on
 * the right number instead of double counting. That is why the rows are
 * upserts of absolute values rather than increments.
 *
 * A "day" is a calendar day in ACCOUNT_TIMEZONE, the same clock the owner
 * reads the dashboard in. `date` on DailyStat stores that calendar day.
 */

export type DayKey = string; // "YYYY-MM-DD"

/** Global metrics (key ""). Per-dimension metrics carry a key. */
export const METRICS = {
  contactsNew: "contacts_new",
  messagesIn: "messages_in",
  messagesOut: "messages_out",
  /** key = triggerId */
  triggerFires: "trigger_fires",
  broadcastsSent: "broadcasts_sent",
  optOuts: "opt_outs",
  /** key = flowId. */
  goals: "goals",
} as const;

/** The calendar day `at` falls on, in the account timezone. */
export function dayOf(at: Date, timeZone = accountTimeZone()): DayKey {
  const w = wallClockIn(at, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** [start, end) instants of a calendar day in the account timezone. */
export function dayBounds(day: DayKey, timeZone = accountTimeZone()): { start: Date; end: Date } {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const base = { hour: 0, minute: 0, second: 0 };
  const start = wallClockToDate({ year: y, month: m, day: d, ...base }, timeZone);
  // Let Date.UTC normalize month/year overflow for the day after.
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = wallClockToDate(
    { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), ...base },
    timeZone,
  );
  return { start, end };
}

/** The DATE column value for a day key. */
export function dateColumn(day: DayKey): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

type Row = { metric: string; key: string; value: number };

/** Recompute every daily metric for one day. Returns what was written. */
export async function rollupDay(db: PrismaClient, day: DayKey): Promise<Row[]> {
  const { start, end } = dayBounds(day);
  const range = { gte: start, lt: end };

  const [contactsNew, messagesIn, messagesOut, broadcastsSent, optOuts, fires, goals] =
    await Promise.all([
      db.contact.count({ where: { createdAt: range } }),
      db.message.count({ where: { direction: "INBOUND", createdAt: range } }),
      db.message.count({
        where: { direction: "OUTBOUND", status: { not: "FAILED" }, createdAt: range },
      }),
      db.broadcastRecipient.count({ where: { status: "SENT", sentAt: range } }),
      db.contact.count({ where: { unsubscribedAt: range } }),
      db.triggerFire.groupBy({ by: ["triggerId"], where: { at: range }, _count: { _all: true } }),
      goalHits(db, range),
    ]);

  const rows: Row[] = [
    { metric: METRICS.contactsNew, key: "", value: contactsNew },
    { metric: METRICS.messagesIn, key: "", value: messagesIn },
    { metric: METRICS.messagesOut, key: "", value: messagesOut },
    { metric: METRICS.broadcastsSent, key: "", value: broadcastsSent },
    { metric: METRICS.optOuts, key: "", value: optOuts },
    ...fires.map((f) => ({ metric: METRICS.triggerFires, key: f.triggerId, value: f._count._all })),
    ...goals.map((g) => ({ metric: METRICS.goals, key: g.flowId, value: g.count })),
  ];

  const date = dateColumn(day);
  for (const r of rows) {
    await db.dailyStat.upsert({
      where: { date_metric_key: { date, metric: r.metric, key: r.key } },
      create: { date, ...r },
      update: { value: r.value },
    });
  }
  return rows;
}

/**
 * Roll up today and yesterday. Yesterday again because a webhook that lands
 * just after midnight, or a delayed send, belongs to the day before and the
 * previous run missed it. Meant for the tick / worker; cheap enough to run
 * every time.
 */
export async function rollupRecent(db: PrismaClient, now = new Date()): Promise<DayKey[]> {
  const today = dayOf(now);
  const yesterday = dayOf(new Date(dayBounds(today).start.getTime() - 1));
  for (const day of [yesterday, today]) await rollupDay(db, day);
  return [yesterday, today];
}

/** Goal hits per flow in the range, from the rows the goal node writes. */
async function goalHits(
  db: PrismaClient,
  at: { gte: Date; lt: Date },
): Promise<Array<{ flowId: string; count: number }>> {
  const rows = await db.flowGoalHit.groupBy({
    by: ["flowId"],
    where: { at },
    _count: { _all: true },
  });
  return rows.map((r) => ({ flowId: r.flowId, count: r._count._all }));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

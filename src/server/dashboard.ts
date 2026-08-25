import type { PrismaClient } from "@prisma/client";
import { METRICS, dateColumn, type DayKey } from "./rollup";
import { dailySeries, lastDays, listDays, totalsByKey } from "./stats";
import { flowFunnel } from "./flow-funnel";
import { WINDOW_MS } from "../lib/messaging-window";

/**
 * Everything the home page shows, in one call.
 *
 * Series come from DailyStat (rolled up by server/rollup.ts), so the page
 * costs a few hundred rows however busy the account is. The two numbers
 * that must be live — total contacts and "reachable now" — are counted on
 * Contact directly, because a daily aggregate cannot say who wrote in the
 * last 24 hours.
 */

export type DayRow = { date: DayKey } & Record<string, number | string>;

export type TriggerSeries = {
  rows: DayRow[];
  /** Column keys in slot order; "other" last when present. */
  keys: Array<{ key: string; label: string }>;
};

export type Dashboard = {
  days: number;
  cards: {
    contacts: number;
    new7d: number;
    messagesIn7d: number;
    messagesOut7d: number;
    reachableNow: number;
    optOuts7d: number;
  };
  contactsNew: DayRow[];
  messages: DayRow[];
  triggerFires: TriggerSeries;
  topTriggers: Array<{ id: string; label: string; flowName: string | null; fires: number }>;
  topFlows: Array<{
    id: string;
    name: string;
    started: number;
    completed: number;
    goals: number;
    /** completed / started as a percentage, or null with no runs. */
    rate: number | null;
  }>;
  recentErrors: Array<{ id: string; at: Date; scope: string; message: string }>;
  recentBroadcasts: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    total: number;
    sent: number;
  }>;
};

const MAX_TRIGGER_SERIES = 4;

/**
 * Per-trigger daily columns for the top `max` triggers, everything else
 * folded into "other". Pure, so the fold is testable without a database.
 */
export function triggerSeries(
  rows: Array<{ date: DayKey; key: string; value: number }>,
  days: DayKey[],
  labelOf: (key: string) => string,
  max = MAX_TRIGGER_SERIES,
): TriggerSeries {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.key, (totals.get(r.key) ?? 0) + r.value);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const top = ranked.slice(0, max);
  const hasOther = ranked.length > max;

  const byDay = new Map<DayKey, DayRow>(days.map((d) => [d, { date: d }]));
  for (const d of days) {
    const row = byDay.get(d)!;
    for (const k of top) row[k] = 0;
    if (hasOther) row.other = 0;
  }
  for (const r of rows) {
    const row = byDay.get(r.date);
    if (!row) continue;
    const k = top.includes(r.key) ? r.key : "other";
    row[k] = ((row[k] as number) ?? 0) + r.value;
  }

  const keys = top.map((key) => ({ key, label: labelOf(key) }));
  if (hasOther) keys.push({ key: "other", label: "outros" });
  return { rows: days.map((d) => byDay.get(d)!), keys };
}

export async function dashboardData(db: PrismaClient, now = new Date()): Promise<Dashboard> {
  const days = 30;
  const range = lastDays(days, now);
  const week = lastDays(7, now);
  const dayKeys = listDays(range.from, range.to);
  const cutoff = new Date(now.getTime() - WINDOW_MS);

  const [
    contacts,
    reachableNow,
    contactsNew,
    messagesIn,
    messagesOut,
    weekNew,
    weekIn,
    weekOut,
    weekOptOuts,
    fireRows,
    weekFires,
    flows,
    errors,
    broadcasts,
  ] = await Promise.all([
    db.contact.count(),
    db.contact.count({ where: { subscribed: true, lastInboundAt: { gt: cutoff } } }),
    dailySeries(db, { metric: METRICS.contactsNew, ...range }),
    dailySeries(db, { metric: METRICS.messagesIn, ...range }),
    dailySeries(db, { metric: METRICS.messagesOut, ...range }),
    totalsByKey(db, METRICS.contactsNew, week.from, week.to),
    totalsByKey(db, METRICS.messagesIn, week.from, week.to),
    totalsByKey(db, METRICS.messagesOut, week.from, week.to),
    totalsByKey(db, METRICS.optOuts, week.from, week.to),
    db.dailyStat.findMany({
      where: {
        metric: METRICS.triggerFires,
        date: { gte: dateColumn(range.from), lte: dateColumn(range.to) },
      },
      select: { date: true, key: true, value: true },
    }),
    totalsByKey(db, METRICS.triggerFires, week.from, week.to),
    db.flow.findMany({
      where: { enabled: true },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    db.errorEvent.findMany({
      orderBy: { at: "desc" },
      take: 5,
      select: { id: true, at: true, scope: true, message: true },
    }),
    db.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { recipients: { select: { status: true } } },
    }),
  ]);

  // Labels for every trigger that fired in the period, in one query.
  const triggerIds = [...new Set([...fireRows.map((r) => r.key), ...Object.keys(weekFires)])];
  const triggers = triggerIds.length
    ? await db.trigger.findMany({
        where: { id: { in: triggerIds } },
        select: { id: true, kind: true, pattern: true, flow: { select: { name: true } } },
      })
    : [];
  const triggerById = new Map(triggers.map((t) => [t.id, t]));
  const labelOf = (id: string) => {
    const t = triggerById.get(id);
    if (!t) return "gatilho removido";
    return t.pattern ? `${kindShort(t.kind)}: ${t.pattern}` : kindShort(t.kind);
  };

  const funnels = await Promise.all(
    flows.map(async (f) => {
      const fn = await flowFunnel(db, f.id, dateColumn(range.from), now);
      return {
        id: f.id,
        name: f.name,
        started: fn?.started ?? 0,
        completed: fn?.completed ?? 0,
        goals: fn?.goals ?? 0,
        rate: fn && fn.started > 0 ? Math.round((fn.completed / fn.started) * 1000) / 10 : null,
      };
    }),
  );

  return {
    days,
    cards: {
      contacts,
      new7d: weekNew[""] ?? 0,
      messagesIn7d: weekIn[""] ?? 0,
      messagesOut7d: weekOut[""] ?? 0,
      reachableNow,
      optOuts7d: weekOptOuts[""] ?? 0,
    },
    contactsNew: contactsNew.map((p) => ({ date: p.date, value: p.value })),
    messages: dayKeys.map((date, i) => ({
      date,
      in: messagesIn[i]?.value ?? 0,
      out: messagesOut[i]?.value ?? 0,
    })),
    triggerFires: triggerSeries(
      fireRows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        key: r.key,
        value: r.value,
      })),
      dayKeys,
      labelOf,
    ),
    topTriggers: Object.entries(weekFires)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, fires]) => ({
        id,
        label: labelOf(id),
        flowName: triggerById.get(id)?.flow.name ?? null,
        fires,
      })),
    topFlows: funnels
      .filter((f) => f.started > 0)
      .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
      .slice(0, 5),
    recentErrors: errors,
    recentBroadcasts: broadcasts.map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      createdAt: b.createdAt,
      total: b.recipients.length,
      sent: b.recipients.filter((r) => r.status !== "PENDING" && r.status !== "FAILED").length,
    })),
  };
}

function kindShort(kind: string): string {
  switch (kind) {
    case "KEYWORD":
      return "palavra";
    case "COMMENT":
      return "comentário";
    case "STORY_REPLY":
      return "story";
    case "STORY_MENTION":
      return "menção";
    case "REF":
      return "link";
    case "DEFAULT":
      return "padrão";
    case "WELCOME":
      return "boas-vindas";
    default:
      return kind.toLowerCase();
  }
}

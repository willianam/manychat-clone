import type { PrismaClient } from "@prisma/client";
import { normalizeRefCode, parseReferral, type MessagingEvent } from "../lib/entry-events";
import { dayBounds, dayOf, type DayKey } from "./rollup";
import { lastDays, listDays } from "./stats";

/**
 * Daily clicks and first contacts per ref link.
 *
 * There is no daily aggregate for links, so the series is rebuilt from two
 * sources the app already keeps: the `referral` webhook events (one per
 * click, the raw payload carries the code) and contacts whose `source` is
 * `ref:<code>` (created on the click that brought them in). "Contacts" is
 * therefore first-time arrivals, not the lifetime `conversions` counter on
 * the row, which also counts returning contacts who re-entered the flow.
 * A month of a personal account is a few hundred rows; both are read once.
 */

export type RefLinkDay = { date: DayKey; clicks: number; contacts: number };

export type RefLinkStats = {
  days: DayKey[];
  /** Per code: one row per day, zero-filled. */
  byCode: Map<string, RefLinkDay[]>;
};

type Stamped = { code: string; at: Date };

/** Pure fold of stamped clicks/contacts into per-code daily rows. */
export function refLinkDaily(
  clicks: Stamped[],
  contacts: Stamped[],
  codes: string[],
  days: DayKey[],
  toDay: (at: Date) => DayKey = dayOf,
): Map<string, RefLinkDay[]> {
  const byCode = new Map<string, Map<DayKey, RefLinkDay>>();
  for (const code of codes) {
    byCode.set(code, new Map(days.map((date) => [date, { date, clicks: 0, contacts: 0 }])));
  }
  const bump = (items: Stamped[], field: "clicks" | "contacts") => {
    for (const it of items) {
      const row = byCode.get(it.code)?.get(toDay(it.at));
      if (row) row[field]++;
    }
  };
  bump(clicks, "clicks");
  bump(contacts, "contacts");

  return new Map([...byCode].map(([code, rows]) => [code, days.map((d) => rows.get(d)!)]));
}

export async function refLinkStats(
  db: PrismaClient,
  codes: string[],
  opts: { days?: number; now?: Date } = {},
): Promise<RefLinkStats> {
  const now = opts.now ?? new Date();
  const range = lastDays(opts.days ?? 30, now);
  const days = listDays(range.from, range.to);
  const start = dayBounds(range.from).start;

  const [events, contacts] = await Promise.all([
    db.webhookEvent.findMany({
      where: { kind: "referral", receivedAt: { gte: start } },
      select: { raw: true, receivedAt: true },
    }),
    db.contact.findMany({
      where: { source: { startsWith: "ref:" }, createdAt: { gte: start } },
      select: { source: true, createdAt: true },
    }),
  ]);

  const clicks: Stamped[] = [];
  for (const e of events) {
    const ref = parseReferral(e.raw as MessagingEvent);
    if (ref) clicks.push({ code: normalizeRefCode(ref.ref), at: e.receivedAt });
  }
  const arrivals: Stamped[] = contacts.map((c) => ({
    code: (c.source ?? "").slice("ref:".length),
    at: c.createdAt,
  }));

  return { days, byCode: refLinkDaily(clicks, arrivals, codes, days) };
}

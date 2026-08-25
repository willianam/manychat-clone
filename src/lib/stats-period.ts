/**
 * The period picker shared by the editor's metrics. Kept as a tiny value
 * object so the server action and the client agree on the same four
 * choices and the same date arithmetic.
 */
export const STATS_PERIODS = ["7d", "30d", "90d", "all"] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

export const PERIOD_LABEL: Record<StatsPeriod, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  all: "Desde o início",
};

export function isStatsPeriod(v: unknown): v is StatsPeriod {
  return typeof v === "string" && (STATS_PERIODS as readonly string[]).includes(v);
}

/** `from` is absent for "all"; `to` is always now. */
export function periodRange(period: StatsPeriod, now = new Date()): { from?: Date; to: Date } {
  if (period === "all") return { to: now };
  const days = Number(period.slice(0, -1));
  return { from: new Date(now.getTime() - days * 86_400_000), to: now };
}

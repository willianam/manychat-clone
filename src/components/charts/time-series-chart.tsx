"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { Props } from "./time-series-chart-recharts";

/**
 * The chart, loaded on demand.
 *
 * recharts is ~167 kB and it was in the First Load of both the dashboard and
 * `/ref-links`, where the chart sits inside a `<details>` that starts closed.
 * Splitting it here rather than at each call site keeps both routes covered by
 * one decision; `time-series-chart-recharts.tsx` holds the chart itself.
 */
const Lazy = dynamic(() => import("./time-series-chart-recharts").then((m) => m.TimeSeriesChart), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

export function TimeSeriesChart(props: Props) {
  return <Lazy {...props} />;
}

export type { Row } from "./time-series-chart-recharts";

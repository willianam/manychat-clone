"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS_TEXT, GRID } from "@/lib/ui/chart-palette";
import { ChartLegend, ChartTable, ChartTooltip, shortDay, type Series } from "./chart-bits";

export type Row = { date: string } & Record<string, string | number>;

const axis = { tick: { fontSize: 11, fill: AXIS_TEXT }, axisLine: false, tickLine: false } as const;

/**
 * Daily series over the dashboard's 30 days: lines for one or two measures,
 * stacked columns for parts of a whole. Marks follow the dataviz specs —
 * 2px lines, thin columns with a 2px surface gap between stacked segments,
 * hairline grid, one axis — and every chart ships a tooltip and a table.
 */
export function TimeSeriesChart({
  rows,
  series,
  kind,
  title,
  height = 220,
}: {
  rows: Row[];
  series: Series[];
  kind: "line" | "stacked";
  title: string;
  height?: number;
}) {
  const empty = rows.every((r) => series.every((s) => !r[s.key]));
  return (
    <figure aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-medium">{title}</figcaption>
        <ChartLegend series={series} shape={kind === "line" ? "line" : "rect"} />
      </div>
      <div className="relative mt-3" style={{ height }}>
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Nada nos últimos 30 dias.
          </p>
        )}
        <ResponsiveContainer width="100%" height="100%">
          {kind === "line" ? (
            <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
              <XAxis dataKey="date" tickFormatter={shortDay} minTickGap={24} {...axis} />
              <YAxis allowDecimals={false} width={48} {...axis} />
              <Tooltip
                cursor={{ stroke: GRID, strokeWidth: 1 }}
                content={(p) => <ChartTooltip {...p} series={series} />}
              />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "#ffffff" }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart
              data={rows}
              margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
              barCategoryGap="30%"
            >
              <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
              <XAxis dataKey="date" tickFormatter={shortDay} minTickGap={24} {...axis} />
              <YAxis allowDecimals={false} width={48} {...axis} />
              <Tooltip
                cursor={{ fill: GRID, fillOpacity: 0.4 }}
                content={(p) => <ChartTooltip {...p} series={series} />}
              />
              {series.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="a"
                  fill={s.color}
                  stroke="#ffffff"
                  strokeWidth={1}
                  maxBarSize={24}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <ChartTable rows={rows} series={series} />
    </figure>
  );
}

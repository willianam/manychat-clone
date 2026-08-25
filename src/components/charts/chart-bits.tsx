"use client";

import type { TooltipContentProps } from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Pieces shared by the dashboard charts: the tooltip, the legend and the
 * table view. Values wear text tokens; identity comes from the swatch next
 * to the label, never from colored text.
 */

export type Series = { key: string; label: string; color: string };

/** "25/08" from a "YYYY-MM-DD" day key. */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

export function ChartTooltip({
  active,
  payload,
  label,
  series,
}: Pick<TooltipContentProps<number, string>, "active" | "payload" | "label"> & {
  series: Series[];
}) {
  if (!active || !payload?.length) return null;
  const byKey = new Map(payload.map((p) => [String(p.dataKey), p.value]));
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{shortDay(String(label))}</div>
      <ul className="space-y-0.5">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="tabular-nums font-semibold">{byKey.get(s.key) ?? 0}</span>
            <span className="text-muted-foreground">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartLegend({ series, shape }: { series: Series[]; shape: "line" | "rect" }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            className={shape === "line" ? "h-0.5 w-3 rounded" : "h-2.5 w-2.5 rounded-sm"}
            style={{ backgroundColor: s.color }}
            aria-hidden
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Every value the chart draws, reachable without hovering. */
export function ChartTable({
  rows,
  series,
}: {
  rows: Array<Record<string, string | number>>;
  series: Series[];
}) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Ver como tabela
      </summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              {series.map((s) => (
                <TableHead key={s.key} className="text-right">
                  {s.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={String(r.date)}>
                <TableCell>{shortDay(String(r.date))}</TableCell>
                {series.map((s) => (
                  <TableCell key={s.key} className="text-right tabular-nums">
                    {r[s.key] ?? 0}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </details>
  );
}

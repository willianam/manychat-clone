// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
// The chart itself; time-series-chart.tsx is only the next/dynamic wrapper.
import { TimeSeriesChart } from "../charts/time-series-chart-recharts";
import { ChartTooltip } from "../charts/chart-bits";

afterEach(cleanup);

const series = [
  { key: "in", label: "recebidas", color: "#4f46e5" },
  { key: "out", label: "enviadas", color: "#0d9488" },
];
const rows = [
  { date: "2026-08-24", in: 3, out: 5 },
  { date: "2026-08-25", in: 1, out: 0 },
];

describe("TimeSeriesChart", () => {
  it("names the figure, shows a legend for two series and a table with every value", () => {
    render(<TimeSeriesChart rows={rows} series={series} kind="line" title="Mensagens" />);
    expect(screen.getByRole("figure", { name: "Mensagens" })).toBeTruthy();
    // Once in the legend, once as a table header.
    expect(screen.getAllByText("recebidas")).toHaveLength(2);
    expect(screen.getByText("Ver como tabela")).toBeTruthy();
    expect(screen.getByRole("cell", { name: "24/08" })).toBeTruthy();
    expect(screen.getAllByRole("cell", { name: "5" })).toHaveLength(1);
  });

  it("says so when the period is empty and skips the legend for one series", () => {
    render(
      <TimeSeriesChart
        rows={[{ date: "2026-08-25", value: 0 }]}
        series={[{ key: "value", label: "novos", color: "#4f46e5" }]}
        kind="line"
        title="Contatos"
      />,
    );
    expect(screen.getByText("Nada nos últimos 30 dias.")).toBeTruthy();
    // Only the table header names the series: no legend box for one series.
    expect(screen.getAllByText("novos")).toHaveLength(1);
  });
});

describe("ChartTooltip", () => {
  it("lists every series with its value, zero-filled", () => {
    render(
      <ChartTooltip
        active
        label="2026-08-24"
        payload={[{ dataKey: "in", value: 3 }] as never}
        series={series}
      />,
    );
    expect(screen.getByText("24/08")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });
});

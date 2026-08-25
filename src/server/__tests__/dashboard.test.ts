import { describe, expect, it } from "vitest";
import { triggerSeries } from "../dashboard";

const days = ["2026-08-23", "2026-08-24", "2026-08-25"];

describe("triggerSeries", () => {
  it("keeps the top triggers as columns and folds the tail into 'other'", () => {
    const rows = [
      { date: "2026-08-23", key: "a", value: 10 },
      { date: "2026-08-24", key: "a", value: 5 },
      { date: "2026-08-23", key: "b", value: 8 },
      { date: "2026-08-25", key: "c", value: 2 },
      { date: "2026-08-25", key: "d", value: 1 },
    ];
    const s = triggerSeries(rows, days, (k) => k.toUpperCase(), 2);

    expect(s.keys).toEqual([
      { key: "a", label: "A" },
      { key: "b", label: "B" },
      { key: "other", label: "outros" },
    ]);
    expect(s.rows).toEqual([
      { date: "2026-08-23", a: 10, b: 8, other: 0 },
      { date: "2026-08-24", a: 5, b: 0, other: 0 },
      { date: "2026-08-25", a: 0, b: 0, other: 3 },
    ]);
  });

  it("has no 'other' column when everything fits", () => {
    const s = triggerSeries([{ date: "2026-08-24", key: "a", value: 1 }], days, (k) => k);
    expect(s.keys).toEqual([{ key: "a", label: "a" }]);
    expect(s.rows[1]).toEqual({ date: "2026-08-24", a: 1 });
    expect(s.rows[0]).toEqual({ date: "2026-08-23", a: 0 });
  });

  it("ignores rows outside the requested days", () => {
    const s = triggerSeries([{ date: "2026-01-01", key: "a", value: 9 }], days, (k) => k);
    expect(s.rows.every((r) => r.a === 0)).toBe(true);
  });
});

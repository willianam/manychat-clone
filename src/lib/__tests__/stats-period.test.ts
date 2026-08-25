import { describe, expect, it } from "vitest";
import { isStatsPeriod, periodRange } from "../stats-period";

describe("stats period", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  it("counts back whole days from now", () => {
    expect(periodRange("7d", now)).toEqual({ from: new Date("2026-08-18T12:00:00Z"), to: now });
    expect(periodRange("90d", now).from).toEqual(new Date("2026-05-27T12:00:00Z"));
  });

  it("leaves 'all' unbounded below", () => {
    expect(periodRange("all", now)).toEqual({ to: now });
  });

  it("guards the action input", () => {
    expect(isStatsPeriod("30d")).toBe(true);
    expect(isStatsPeriod("1d")).toBe(false);
    expect(isStatsPeriod(30)).toBe(false);
  });
});

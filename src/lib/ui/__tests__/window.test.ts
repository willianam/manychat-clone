import { describe, expect, it } from "vitest";
import { formatRemaining, windowState, windowSummary } from "../window";

const NOW = new Date("2026-08-25T12:00:00Z");
const H = 3_600_000;

describe("window helpers", () => {
  it("classifies never / in / out with the 24h cutoff", () => {
    expect(windowState(null, NOW)).toBe("never");
    expect(windowState(new Date(NOW.getTime() - 23 * H), NOW)).toBe("in");
    expect(windowState(new Date(NOW.getTime() - 24 * H), NOW)).toBe("in");
    expect(windowState(new Date(NOW.getTime() - 24 * H - 1), NOW)).toBe("out");
  });

  it("formats the countdown in hours and minutes", () => {
    expect(formatRemaining(30_000)).toBe("menos de 1min");
    expect(formatRemaining(45 * 60_000)).toBe("45min");
    expect(formatRemaining(2 * H)).toBe("2h");
    expect(formatRemaining(13 * H + 20 * 60_000)).toBe("13h 20min");
  });

  it("summarises with the countdown only when inside", () => {
    expect(windowSummary(null, NOW)).toBe("nunca escreveu");
    expect(windowSummary(new Date(NOW.getTime() - 30 * H), NOW)).toBe("fora da janela");
    expect(windowSummary(new Date(NOW.getTime() - 10 * H), NOW)).toBe("dentro · 14h");
  });
});

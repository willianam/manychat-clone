import { describe, expect, it } from "vitest";
import { formatDuration, relativeTime } from "../time";

const NOW = new Date("2026-08-27T15:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("relativeTime", () => {
  it("steps from 'agora' to minutes, hours, days, then a date", () => {
    expect(relativeTime(ago(10_000), NOW)).toBe("agora");
    expect(relativeTime(ago(5 * 60_000), NOW)).toBe("5 min");
    expect(relativeTime(ago(3 * 3_600_000), NOW)).toBe("3 h");
    expect(relativeTime(ago(2 * 86_400_000), NOW)).toBe("2 d");
    expect(relativeTime(ago(10 * 86_400_000), NOW)).toMatch(/^\d{2}\/\d{2}$/);
  });
});

describe("formatDuration", () => {
  it("formats the window counter", () => {
    expect(formatDuration(30_000)).toBe("menos de 1 min");
    expect(formatDuration(45 * 60_000)).toBe("45 min");
    expect(formatDuration(23 * 3_600_000 + 7 * 60_000)).toBe("23h 07min");
  });
});

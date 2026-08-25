import { describe, it, expect } from "vitest";
import { parseBroadcastForm } from "../broadcast-form";
import { parseLocalDateTime, wallClockToDate, wallClockIn } from "../timezone";

const NOW = new Date("2026-08-25T12:00:00Z"); // 09:00 in São Paulo

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

describe("parseBroadcastForm", () => {
  it("reads scheduledAt as a wall-clock time in the account's zone", () => {
    const draft = parseBroadcastForm(
      form({ name: "promo", text: "oi", scheduledAt: "2026-08-25T15:00" }),
      { now: NOW, timeZone: "America/Sao_Paulo" },
    );
    // 15:00 in São Paulo (UTC-3, no DST in 2026) is 18:00Z.
    expect(draft.scheduledAt).toEqual(new Date("2026-08-25T18:00:00Z"));
    expect(draft).toMatchObject({ name: "promo", text: "oi", filterTagIds: [] });
  });

  it("interprets the same wall-clock time differently in another zone", () => {
    const tokyo = parseBroadcastForm(form({ text: "oi", scheduledAt: "2026-08-26T09:00" }), {
      now: NOW,
      timeZone: "Asia/Tokyo",
    });
    expect(tokyo.scheduledAt).toEqual(new Date("2026-08-26T00:00:00Z"));
  });

  it("leaves scheduledAt null when the field is blank", () => {
    const draft = parseBroadcastForm(form({ text: "oi", scheduledAt: "" }), { now: NOW });
    expect(draft.scheduledAt).toBeNull();
  });

  it("rejects a time in the past, and the present", () => {
    expect(() =>
      parseBroadcastForm(form({ text: "oi", scheduledAt: "2026-08-25T08:59" }), {
        now: NOW,
        timeZone: "America/Sao_Paulo",
      }),
    ).toThrow("futuro");
    expect(() =>
      parseBroadcastForm(form({ text: "oi", scheduledAt: "2026-08-25T09:00" }), {
        now: NOW,
        timeZone: "America/Sao_Paulo",
      }),
    ).toThrow("futuro");
  });

  it("rejects garbage instead of guessing a date", () => {
    expect(() =>
      parseBroadcastForm(form({ text: "oi", scheduledAt: "amanhã" }), { now: NOW }),
    ).toThrow("inválida");
  });

  it("keeps the existing rules: text required, name defaulted, tag ids collected", () => {
    expect(() => parseBroadcastForm(form({ text: "  " }), { now: NOW })).toThrow("vazia");
    const draft = parseBroadcastForm(form({ text: "oi", tagIds: ["t1", "", "t2"] }), { now: NOW });
    expect(draft.name).toBe("Disparo sem nome");
    expect(draft.filterTagIds).toEqual(["t1", "t2"]);
  });
});

describe("timezone helpers", () => {
  it("round-trips a wall clock through an instant", () => {
    const wall = { year: 2026, month: 8, day: 25, hour: 15, minute: 30, second: 0 };
    const instant = wallClockToDate(wall, "America/Sao_Paulo");
    expect(wallClockIn(instant, "America/Sao_Paulo")).toEqual(wall);
  });

  it("handles a DST transition without landing an hour off", () => {
    // New York springs forward on 2026-03-08 at 02:00 → 03:00.
    const before = parseLocalDateTime("2026-03-08T01:30", "America/New_York");
    const after = parseLocalDateTime("2026-03-08T03:30", "America/New_York");
    expect(before).toEqual(new Date("2026-03-08T06:30:00Z")); // EST, UTC-5
    expect(after).toEqual(new Date("2026-03-08T07:30:00Z")); // EDT, UTC-4
  });

  it("returns null for shapes a datetime-local input never produces", () => {
    expect(parseLocalDateTime("2026-08-25", "UTC")).toBeNull();
    expect(parseLocalDateTime("25/08/2026 15:00", "UTC")).toBeNull();
  });
});

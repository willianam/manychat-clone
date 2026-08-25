import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { refLinkDaily, refLinkStats } from "../ref-link-stats";

const days = ["2026-08-24", "2026-08-25"];
const toDay = (at: Date) => at.toISOString().slice(0, 10);

describe("refLinkDaily", () => {
  it("zero-fills every code and day, then counts clicks and contacts per day", () => {
    const out = refLinkDaily(
      [
        { code: "bio", at: new Date("2026-08-24T10:00:00Z") },
        { code: "bio", at: new Date("2026-08-24T11:00:00Z") },
        { code: "ads", at: new Date("2026-08-25T09:00:00Z") },
        { code: "unknown", at: new Date("2026-08-25T09:00:00Z") },
      ],
      [{ code: "bio", at: new Date("2026-08-24T10:00:30Z") }],
      ["bio", "ads"],
      days,
      toDay,
    );
    expect(out.get("bio")).toEqual([
      { date: "2026-08-24", clicks: 2, contacts: 1 },
      { date: "2026-08-25", clicks: 0, contacts: 0 },
    ]);
    expect(out.get("ads")).toEqual([
      { date: "2026-08-24", clicks: 0, contacts: 0 },
      { date: "2026-08-25", clicks: 1, contacts: 0 },
    ]);
    expect(out.has("unknown")).toBe(false);
  });
});

describe("refLinkStats", () => {
  it("reads the code out of the stored webhook payload and the contact source", async () => {
    const db = {
      webhookEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            raw: { sender: { id: "1" }, referral: { ref: "Bio", source: "SHORTLINK" } },
            receivedAt: new Date("2026-08-25T12:00:00Z"),
          },
          {
            raw: { sender: { id: "2" }, message: { mid: "m", referral: { ref: "bio" } } },
            receivedAt: new Date("2026-08-25T13:00:00Z"),
          },
          { raw: { sender: { id: "3" } }, receivedAt: new Date("2026-08-25T13:00:00Z") },
        ]),
      },
      contact: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ source: "ref:bio", createdAt: new Date("2026-08-25T12:00:10Z") }]),
      },
    } as unknown as PrismaClient;

    const s = await refLinkStats(db, ["bio"], { days: 2, now: new Date("2026-08-25T18:00:00Z") });
    expect(s.days).toHaveLength(2);
    const last = s.byCode.get("bio")!.at(-1)!;
    expect(last).toMatchObject({ clicks: 2, contacts: 1 });
    expect(vi.mocked(db.webhookEvent.findMany).mock.calls[0][0]?.where).toMatchObject({
      kind: "referral",
    });
  });
});

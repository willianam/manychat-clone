import { describe, it, expect } from "vitest";
import {
  captureAttachments,
  daysUntilExpiry,
  expiryStateOf,
  expiryLabel,
  attachmentsOf,
  attachmentPreview,
  ATTACHMENT_TTL_DAYS,
} from "../inbound-attachments";

const now = new Date(2026, 7, 17, 12, 0, 0);
const later = (days: number) =>
  new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

describe("captureAttachments", () => {
  it("records the original URL and a 7-day expiry", () => {
    const out = captureAttachments(
      [{ type: "image", payload: { url: "https://cdn.meta/x.jpg" } }],
      now,
    );

    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("https://cdn.meta/x.jpg");
    expect(out[0]!.type).toBe("image");
    expect(out[0]!.capturedAt).toBe(now.toISOString());
    expect(out[0]!.expiresAt).toBe(later(ATTACHMENT_TTL_DAYS).toISOString());
  });

  it("drops attachments that carry no URL, since there is nothing to keep", () => {
    // Stickers arrive with a sticker_id and no url.
    expect(captureAttachments([{ type: "image", payload: { sticker_id: 369 } }], now)).toEqual([]);
  });

  it("keeps a title when Meta sends one", () => {
    const out = captureAttachments(
      [{ type: "file", payload: { url: "https://cdn.meta/d.pdf", title: "contrato.pdf" } }],
      now,
    );
    expect(out[0]!.title).toBe("contrato.pdf");
  });

  it("returns nothing for a message with no attachments", () => {
    expect(captureAttachments(undefined, now)).toEqual([]);
    expect(captureAttachments([], now)).toEqual([]);
  });
});

describe("expiry reporting", () => {
  const a = captureAttachments([{ type: "image", payload: { url: "https://cdn/x" } }], now)[0]!;

  it("counts down the days remaining", () => {
    expect(daysUntilExpiry(a, now)).toBe(ATTACHMENT_TTL_DAYS);
    expect(daysUntilExpiry(a, later(6))).toBe(1);
  });

  it("is ok while there is time, then warns, then reports expired", () => {
    expect(expiryStateOf(a, now)).toBe("ok");
    expect(expiryStateOf(a, later(5.5))).toBe("expiring");
    expect(expiryStateOf(a, later(8))).toBe("expired");
  });

  it("labels the deadline in pt-BR", () => {
    expect(expiryLabel(a, now)).toBe("expira em 7 dias");
    expect(expiryLabel(a, later(6))).toBe("expira amanhã");
    expect(expiryLabel(a, later(6.5))).toBe("expira hoje");
    expect(expiryLabel(a, later(8))).toBe("link expirado");
  });
});

describe("attachmentsOf", () => {
  it("reads back what was stored", () => {
    const stored = captureAttachments([{ type: "video", payload: { url: "https://cdn/v" } }], now);
    expect(attachmentsOf({ attachments: stored })).toEqual(stored);
  });

  it("tolerates legacy payloads that hold an outbound message instead", () => {
    expect(attachmentsOf({ text: "oi" })).toEqual([]);
    expect(attachmentsOf(null)).toEqual([]);
    expect(attachmentsOf(undefined)).toEqual([]);
    expect(attachmentsOf({ attachments: "nope" })).toEqual([]);
  });
});

describe("attachmentPreview", () => {
  it("names a single attachment and counts several", () => {
    const one = captureAttachments([{ type: "audio", payload: { url: "https://cdn/a" } }], now);
    expect(attachmentPreview(one)).toBe("[áudio]");

    const many = captureAttachments(
      [
        { type: "image", payload: { url: "https://cdn/1" } },
        { type: "image", payload: { url: "https://cdn/2" } },
      ],
      now,
    );
    expect(attachmentPreview(many)).toBe("[2 anexos]");
    expect(attachmentPreview([])).toBe("");
  });
});

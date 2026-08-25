import { describe, it, expect } from "vitest";
import { parseReadReceipt, parseDelivery, type MessagingEvent } from "../entry-events";

/**
 * Shapes below mirror Meta's references verbatim:
 *   message_reads       developers.facebook.com/docs/messenger-platform/reference/webhook-events/message-reads
 *   message_deliveries  developers.facebook.com/docs/messenger-platform/reference/webhook-events/message-deliveries
 *   messaging_seen      Instagram variant, `read.mid` instead of a watermark.
 */

const messengerRead: MessagingEvent = {
  sender: { id: "<PSID>" },
  recipient: { id: "<PAGE_ID>" },
  timestamp: 1458668856463,
  read: { watermark: 1458668856253 },
};

const instagramSeen: MessagingEvent = {
  sender: { id: "IGSID_1" },
  recipient: { id: "IGID" },
  timestamp: 1755000000000,
  read: { mid: "mid.seen.1" },
};

const delivery: MessagingEvent = {
  sender: { id: "<PSID>" },
  recipient: { id: "<PAGE_ID>" },
  delivery: { mids: ["mid.1458668856218:ed81099e15d3f4f233"], watermark: 1458668856253 },
};

describe("read receipts", () => {
  it("reads the Messenger watermark shape", () => {
    expect(parseReadReceipt(messengerRead)).toEqual({
      kind: "read",
      igScopedId: "<PSID>",
      mid: undefined,
      watermark: new Date(1458668856253),
    });
  });

  it("reads the Instagram read.mid shape", () => {
    expect(parseReadReceipt(instagramSeen)).toEqual({
      kind: "read",
      igScopedId: "IGSID_1",
      mid: "mid.seen.1",
      watermark: undefined,
    });
  });

  it("ignores an ordinary message, and a read with nothing in it", () => {
    expect(parseReadReceipt({ sender: { id: "x" }, message: { mid: "m", text: "oi" } })).toBeNull();
    expect(parseReadReceipt({ sender: { id: "x" }, read: {} })).toBeNull();
    expect(parseReadReceipt({ sender: { id: "x" }, read: { watermark: -1 } })).toBeNull();
  });
});

describe("delivery receipts", () => {
  it("reads mids and watermark", () => {
    expect(parseDelivery(delivery)).toEqual({
      kind: "delivery",
      igScopedId: "<PSID>",
      mids: ["mid.1458668856218:ed81099e15d3f4f233"],
      watermark: new Date(1458668856253),
    });
  });

  it("accepts a watermark-only delivery — mids is optional per the reference", () => {
    const d = parseDelivery({ sender: { id: "p" }, delivery: { watermark: 1458668856253 } });
    expect(d?.mids).toEqual([]);
    expect(d?.watermark).toEqual(new Date(1458668856253));
  });

  it("is null for a non-delivery event", () => {
    expect(parseDelivery(messengerRead)).toBeNull();
  });
});

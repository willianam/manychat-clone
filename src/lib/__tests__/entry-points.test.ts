import { describe, it, expect } from "vitest";
import {
  parseStoryReply,
  parseStoryMention,
  parseReferral,
  normalizeRefCode,
  validateRefCode,
  generateRefCode,
  refLinkUrl,
  REF_CODE_MAX,
  type MessagingEvent,
} from "../entry-events";
import {
  IceBreakersInput,
  MenuItemsInput,
  PROFILE_LIMITS,
  buildIceBreakersBody,
  buildPersistentMenuBody,
  flowPayload,
  parseFlowPayload,
} from "../messenger-profile";

/**
 * Payloads below mirror the documented shapes at
 * developers.facebook.com/docs/messenger-platform/instagram/features/webhook
 * — not invented ones. If Meta changes the shape, these fail first.
 */

const storyReplyEvent: MessagingEvent = {
  sender: { id: "IGSID_1" },
  recipient: { id: "PAGE" },
  timestamp: 1755000000000,
  message: {
    mid: "mid.story.reply.1",
    text: "quero saber mais",
    reply_to: { story: { id: "STORY_123", url: "https://cdn.example/story.jpg" } },
  },
};

const storyMentionEvent: MessagingEvent = {
  sender: { id: "IGSID_2" },
  recipient: { id: "PAGE" },
  timestamp: 1755000000001,
  message: {
    mid: "mid.story.mention.1",
    attachments: [{ type: "story_mention", payload: { url: "https://cdn.example/mention.jpg" } }],
  },
};

describe("story reply parsing", () => {
  it("reads the documented reply_to.story shape", () => {
    expect(parseStoryReply(storyReplyEvent)).toEqual({
      kind: "story_reply",
      igScopedId: "IGSID_1",
      mid: "mid.story.reply.1",
      storyId: "STORY_123",
      storyUrl: "https://cdn.example/story.jpg",
      text: "quero saber mais",
    });
  });

  it("ignores an ordinary DM", () => {
    expect(parseStoryReply({ sender: { id: "X" }, message: { mid: "m", text: "oi" } })).toBeNull();
  });

  it("ignores our own echo", () => {
    expect(
      parseStoryReply({
        ...storyReplyEvent,
        message: { ...storyReplyEvent.message, is_echo: true },
      }),
    ).toBeNull();
  });

  it("ignores a quoted story with no text (a sticker-only reaction)", () => {
    expect(
      parseStoryReply({
        sender: { id: "X" },
        message: { mid: "m", reply_to: { story: { id: "S" } } },
      }),
    ).toBeNull();
  });

  it("does not mistake a reply to a message for a reply to a story", () => {
    expect(
      parseStoryReply({
        sender: { id: "X" },
        message: { mid: "m", text: "isso", reply_to: { mid: "other.mid" } },
      }),
    ).toBeNull();
  });

  it("is not confused by a story mention", () => {
    expect(parseStoryReply(storyMentionEvent)).toBeNull();
  });
});

describe("story mention parsing", () => {
  it("reads the documented story_mention attachment", () => {
    expect(parseStoryMention(storyMentionEvent)).toEqual({
      kind: "story_mention",
      igScopedId: "IGSID_2",
      mid: "mid.story.mention.1",
      storyUrl: "https://cdn.example/mention.jpg",
      text: undefined,
    });
  });

  it("ignores other attachment types", () => {
    expect(
      parseStoryMention({
        sender: { id: "X" },
        message: { mid: "m", attachments: [{ type: "image", payload: { url: "u" } }] },
      }),
    ).toBeNull();
  });

  it("is not confused by a story reply", () => {
    expect(parseStoryMention(storyReplyEvent)).toBeNull();
  });
});

describe("referral parsing", () => {
  it("reads a standalone referral event", () => {
    expect(
      parseReferral({
        sender: { id: "X" },
        referral: { ref: "promo_junho", source: "IGME", type: "OPEN_THREAD" },
      }),
    ).toEqual({ ref: "promo_junho", source: "IGME" });
  });

  it("reads a referral folded into the first message of a new thread", () => {
    expect(
      parseReferral({
        sender: { id: "X" },
        message: { mid: "m", text: "oi", referral: { ref: "bio", source: "IGME" } },
      }),
    ).toEqual({ ref: "bio", source: "IGME" });
  });

  it("reads a referral riding on a postback", () => {
    expect(
      parseReferral({
        sender: { id: "X" },
        postback: { mid: "m", payload: "GET_STARTED", referral: { ref: "anuncio" } },
      }),
    ).toEqual({ ref: "anuncio", source: undefined });
  });

  it("returns null for an ig.me link with no ref", () => {
    expect(parseReferral({ sender: { id: "X" }, referral: { source: "IGME" } })).toBeNull();
    expect(parseReferral({ sender: { id: "X" }, message: { mid: "m", text: "oi" } })).toBeNull();
  });
});

describe("ref codes", () => {
  it("normalizes case and surrounding space so a link is case-insensitive", () => {
    expect(normalizeRefCode("  Promo_Junho ")).toBe("promo_junho");
  });

  it("accepts the characters Meta echoes back", () => {
    for (const code of ["promo", "promo_2026", "a.b-c+d", "ABC123"]) {
      expect(validateRefCode(code).ok).toBe(true);
    }
  });

  it("rejects codes Meta would silently drop", () => {
    for (const bad of ["", "   ", "com espaco", "acentuação", "sla/sh", "a?b", "e&f"]) {
      expect(validateRefCode(bad).ok).toBe(false);
    }
  });

  it("rejects a code past Meta's length limit", () => {
    expect(validateRefCode("a".repeat(REF_CODE_MAX)).ok).toBe(true);
    expect(validateRefCode("a".repeat(REF_CODE_MAX + 1)).ok).toBe(false);
  });

  it("returns the normalized code, so lookup matches what was stored", () => {
    const result = validateRefCode("  Promo ");
    expect(result.ok && result.code).toBe("promo");
  });

  it("generates codes that pass its own validation", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRefCode();
      expect(code).toHaveLength(8);
      expect(validateRefCode(code).ok).toBe(true);
      // Normalizing a generated code must be a no-op, or it would be stored
      // under a different key than the one printed in the link.
      expect(normalizeRefCode(code)).toBe(code);
    }
  });

  it("excludes glyphs that are ambiguous when read off a screen", () => {
    const alphabet = new Set(Array.from({ length: 200 }, () => generateRefCode()).join(""));
    for (const ambiguous of ["0", "o", "1", "l", "i"]) {
      expect(alphabet.has(ambiguous)).toBe(false);
    }
  });

  it("builds the ig.me url, tolerating a leading @", () => {
    expect(refLinkUrl("minhaloja", "promo")).toBe("https://ig.me/m/minhaloja?ref=promo");
    expect(refLinkUrl("@minhaloja", "promo")).toBe("https://ig.me/m/minhaloja?ref=promo");
  });
});

describe("ice breaker validation", () => {
  const ok = { question: "Como funciona?", flowId: "flow_1" };

  it("accepts up to Meta's maximum", () => {
    const items = Array.from({ length: PROFILE_LIMITS.iceBreakers }, (_, i) => ({
      question: `Pergunta ${i}`,
      flowId: "flow_1",
    }));
    expect(IceBreakersInput.safeParse(items).success).toBe(true);
  });

  it("rejects more than Meta's maximum", () => {
    const items = Array.from({ length: PROFILE_LIMITS.iceBreakers + 1 }, (_, i) => ({
      question: `Pergunta ${i}`,
      flowId: "flow_1",
    }));
    expect(IceBreakersInput.safeParse(items).success).toBe(false);
  });

  it("rejects a question with no flow behind it", () => {
    expect(IceBreakersInput.safeParse([{ question: "Oi?", flowId: "" }]).success).toBe(false);
  });

  it("rejects an empty or whitespace-only question", () => {
    expect(IceBreakersInput.safeParse([{ question: "   ", flowId: "f" }]).success).toBe(false);
  });

  it("rejects a question past the length limit", () => {
    const long = "a".repeat(PROFILE_LIMITS.iceBreakerQuestion + 1);
    expect(IceBreakersInput.safeParse([{ question: long, flowId: "f" }]).success).toBe(false);
  });

  it("rejects two questions that read identically", () => {
    const parsed = IceBreakersInput.safeParse([ok, { ...ok, question: "como funciona?" }]);
    expect(parsed.success).toBe(false);
  });

  it("trims the question before storing it", () => {
    const parsed = IceBreakersInput.safeParse([{ question: "  Oi?  ", flowId: "f" }]);
    expect(parsed.success && parsed.data[0].question).toBe("Oi?");
  });

  it("builds exactly the body Meta documents", () => {
    expect(buildIceBreakersBody([ok])).toEqual({
      platform: "instagram",
      ice_breakers: [
        {
          locale: "default",
          call_to_actions: [{ question: "Como funciona?", payload: "FLOW:flow_1" }],
        },
      ],
    });
  });
});

describe("persistent menu validation", () => {
  it("accepts a flow item and a link item", () => {
    const parsed = MenuItemsInput.safeParse([
      { type: "postback", title: "Atendente", flowId: "f1" },
      { type: "web_url", title: "Site", url: "https://exemplo.com" },
    ]);
    expect(parsed.success).toBe(true);
  });

  it("rejects more items than the menu can show", () => {
    const items = Array.from({ length: PROFILE_LIMITS.menuItems + 1 }, (_, i) => ({
      type: "postback" as const,
      title: `Item ${i}`,
      flowId: "f1",
    }));
    expect(MenuItemsInput.safeParse(items).success).toBe(false);
  });

  it("rejects a non-https link, which Meta refuses", () => {
    expect(
      MenuItemsInput.safeParse([{ type: "web_url", title: "Site", url: "http://exemplo.com" }])
        .success,
    ).toBe(false);
  });

  it("rejects a title past the length limit", () => {
    const long = "a".repeat(PROFILE_LIMITS.menuTitle + 1);
    expect(MenuItemsInput.safeParse([{ type: "postback", title: long, flowId: "f" }]).success).toBe(
      false,
    );
  });

  it("builds exactly the body Meta documents, with no Instagram-unsupported fields", () => {
    const body = buildPersistentMenuBody([
      { type: "postback", title: "Atendente", flowId: "f1" },
      { type: "web_url", title: "Site", url: "https://exemplo.com" },
    ]);

    expect(body).toEqual({
      platform: "instagram",
      persistent_menu: [
        {
          locale: "default",
          call_to_actions: [
            { type: "postback", title: "Atendente", payload: "FLOW:f1" },
            { type: "web_url", title: "Site", url: "https://exemplo.com" },
          ],
        },
      ],
    });

    // Instagram rejects these outright; they must never be serialized.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("composer_input_disabled");
    expect(serialized).not.toContain("webview_height_ratio");
  });
});

describe("profile payloads", () => {
  it("round-trips a flow id", () => {
    expect(parseFlowPayload(flowPayload("flow_abc"))).toBe("flow_abc");
  });

  it("does not claim a flow-button payload, which names a node", () => {
    expect(parseFlowPayload("node_3:opt_1")).toBeNull();
    expect(parseFlowPayload("GET_STARTED")).toBeNull();
  });

  it("rejects a prefix with nothing behind it", () => {
    expect(parseFlowPayload("FLOW:")).toBeNull();
    expect(parseFlowPayload("FLOW:   ")).toBeNull();
  });
});

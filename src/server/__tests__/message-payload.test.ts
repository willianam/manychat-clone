import { describe, it, expect } from "vitest";
import {
  buildMessage, buildQuickReply, buildCarousel, buildImage,
  buildMedia, buildAlbum,
  postbackPayload, parsePostback, resumeAtFor, previewOf,
} from "../message-payload";
import { LIMITS } from "../../lib/flow-schema";

describe("postback payload", () => {
  it("round-trips node and handle", () => {
    expect(parsePostback(postbackPayload("n1", "btn-a"))).toEqual({
      nodeId: "n1",
      handle: "btn-a",
    });
  });

  it("handles ids that themselves contain a colon", () => {
    // Splits on the FIRST colon, so a handle may contain colons safely.
    expect(parsePostback("n1:a:b")).toEqual({ nodeId: "n1", handle: "a:b" });
  });

  it("rejects malformed payloads instead of guessing", () => {
    expect(parsePostback("nocolon")).toBeNull();
    expect(parsePostback(":orphan")).toBeNull();
    expect(parsePostback("trailing:")).toBeNull();
  });
});

describe("buildMessage", () => {
  it("sends plain text when there are no buttons", () => {
    expect(buildMessage("n1", { kind: "message", text: "oi" })).toEqual({ text: "oi" });
  });

  it("switches to a button template when buttons exist", () => {
    const out = buildMessage("n1", {
      kind: "message",
      text: "Escolha:",
      buttons: [
        { type: "postback", id: "b1", title: "Planos" },
        { type: "url", id: "b2", title: "Site", url: "https://x.com" },
      ],
    }) as never as { attachment: { payload: { template_type: string; buttons: unknown[] } } };

    expect(out.attachment.payload.template_type).toBe("button");
    expect(out.attachment.payload.buttons).toEqual([
      { type: "postback", title: "Planos", payload: "n1:b1" },
      { type: "web_url", title: "Site", url: "https://x.com" },
    ]);
  });

  it("truncates text to the button-template limit", () => {
    const out = buildMessage("n1", {
      kind: "message",
      text: "x".repeat(900),
      buttons: [{ type: "postback", id: "b", title: "ok" }],
    }) as never as { attachment: { payload: { text: string } } };
    expect(out.attachment.payload.text).toHaveLength(LIMITS.buttonTemplateText);
  });
});

describe("buildQuickReply", () => {
  it("emits the documented quick_replies shape", () => {
    const out = buildQuickReply("n2", {
      kind: "quickreply",
      text: "Orçamento?",
      saveAs: "orcamento",
      options: [
        { id: "o1", title: "Até 1k" },
        { id: "o2", title: "Acima de 5k" },
      ],
    }) as never as { text: string; quick_replies: Array<Record<string, string>> };

    expect(out.text).toBe("Orçamento?");
    expect(out.quick_replies[0]).toEqual({
      content_type: "text",
      title: "Até 1k",
      payload: "n2:o1",
    });
  });

  it("cuts titles at 20 chars, since Instagram truncates silently", () => {
    const out = buildQuickReply("n2", {
      kind: "quickreply",
      text: "?",
      saveAs: "k",
      options: [{ id: "o1", title: "um titulo bem longo que estoura o limite" }],
    }) as never as { quick_replies: Array<{ title: string }> };
    expect(out.quick_replies[0]!.title).toHaveLength(LIMITS.quickReplyTitle);
  });
});

describe("buildCarousel", () => {
  it("emits a generic template with per-card buttons", () => {
    const out = buildCarousel("n3", {
      kind: "carousel",
      cards: [
        {
          id: "c1",
          title: "Básico",
          subtitle: "R$ 97",
          imageUrl: "https://cdn/a.jpg",
          buttons: [{ type: "postback", id: "b1", title: "Quero" }],
        },
        { id: "c2", title: "Pro" },
      ],
    }) as never as {
      attachment: { payload: { template_type: string; elements: Array<Record<string, unknown>> } };
    };

    const p = out.attachment.payload;
    expect(p.template_type).toBe("generic");
    expect(p.elements).toHaveLength(2);
    expect(p.elements[0]).toEqual({
      title: "Básico",
      subtitle: "R$ 97",
      image_url: "https://cdn/a.jpg",
      buttons: [{ type: "postback", title: "Quero", payload: "n3:b1" }],
    });
    // Optional fields are omitted rather than sent as undefined, which the
    // Graph API rejects.
    expect(p.elements[1]).toEqual({ title: "Pro" });
  });
});

describe("buildImage", () => {
  it("marks the attachment reusable so re-sends don't re-upload", () => {
    expect(buildImage({ kind: "image", url: "https://cdn/x.png" })).toEqual({
      attachment: { type: "image", payload: { url: "https://cdn/x.png", is_reusable: true } },
    });
  });
});

/**
 * These assert the exact wire shape, because this is where a mistake hides:
 * a wrong key name still type-checks, still passes JSON.stringify, and only
 * surfaces as a 400 from Meta against a live conversation.
 *
 * Shapes confirmed against developers.facebook.com/docs/instagram-platform
 * (Instagram API with Instagram Login → Messaging → Send Messages).
 */
describe("buildMedia", () => {
  it("sends video under the singular attachment key with type video", () => {
    expect(buildMedia({ kind: "video", url: "https://cdn/v.mp4" })).toEqual({
      attachment: { type: "video", payload: { url: "https://cdn/v.mp4", is_reusable: true } },
    });
  });

  it("sends audio with type audio", () => {
    expect(buildMedia({ kind: "audio", url: "https://cdn/a.m4a" })).toEqual({
      attachment: { type: "audio", payload: { url: "https://cdn/a.m4a", is_reusable: true } },
    });
  });

  it("sends a PDF as type file, not 'pdf' or 'document'", () => {
    const out = buildMedia({
      kind: "file",
      url: "https://cdn/p.pdf",
      filename: "proposta.pdf",
    }) as { attachment: { type: string; payload: Record<string, unknown> } };

    expect(out.attachment.type).toBe("file");
    // filename is ours, for the canvas — it must not leak into the payload.
    expect(out.attachment.payload).toEqual({ url: "https://cdn/p.pdf", is_reusable: true });
  });
});

describe("buildAlbum", () => {
  it("uses the PLURAL attachments array, not a singular attachment", () => {
    const out = buildAlbum({
      kind: "album",
      urls: ["https://cdn/1.jpg", "https://cdn/2.jpg"],
    }) as { attachment?: unknown; attachments: Array<Record<string, unknown>> };

    // The distinction that matters: an array under "attachment" is rejected.
    expect(out.attachment).toBeUndefined();
    expect(out.attachments).toEqual([
      { type: "image", payload: { url: "https://cdn/1.jpg", is_reusable: true } },
      { type: "image", payload: { url: "https://cdn/2.jpg", is_reusable: true } },
    ]);
  });

  it("caps the album at ten attachments, the documented maximum", () => {
    const urls = Array.from({ length: 14 }, (_, i) => `https://cdn/${i}.jpg`);
    const out = buildAlbum({ kind: "album", urls }) as { attachments: unknown[] };
    expect(out.attachments).toHaveLength(LIMITS.albumImages);
  });
});

describe("previewOf", () => {
  it("summarises payloads that carry no text", () => {
    expect(previewOf({
      kind: "carousel",
      cards: [{ id: "a", title: "Básico" }, { id: "b", title: "Pro" }],
    })).toBe("[carrossel: Básico, Pro]");
    expect(previewOf({ kind: "image", url: "https://x/y.png" })).toBe("[imagem]");
    expect(previewOf({ kind: "video", url: "https://x/y.mp4" })).toBe("[vídeo]");
    expect(previewOf({ kind: "audio", url: "https://x/y.m4a" })).toBe("[áudio]");
    expect(previewOf({ kind: "file", url: "https://x/y.pdf", filename: "y.pdf" })).toBe(
      "[pdf: y.pdf]",
    );
    expect(previewOf({ kind: "album", urls: ["https://x/1.jpg", "https://x/2.jpg"] })).toBe(
      "[álbum: 2 imagens]",
    );
  });
});

describe("resumeAtFor", () => {
  // These cases are written against the machine's own zone, so `getHours()`
  // reads back what was put in; the zone is passed explicitly because the
  // default is ACCOUNT_TIMEZONE, which is not necessarily where CI runs.
  const LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const at = (h: number) => new Date(2026, 7, 17, h, 0, 0);

  it("adds the delay when no window is set", () => {
    const out = resumeAtFor({ kind: "delay", seconds: 3600 }, at(10), LOCAL);
    expect(out.getHours()).toBe(11);
  });

  it("leaves a time already inside the window alone", () => {
    const out = resumeAtFor(
      { kind: "delay", seconds: 3600, window: { fromHour: 8, toHour: 22 } },
      at(10),
      LOCAL,
    );
    expect(out.getHours()).toBe(11);
  });

  it("pushes a too-early result forward to the window opening", () => {
    // 3am + 1h = 4am, before an 8:00 window → waits until 8:00 same day.
    const out = resumeAtFor(
      { kind: "delay", seconds: 3600, window: { fromHour: 8, toHour: 22 } },
      at(3),
      LOCAL,
    );
    expect(out.getHours()).toBe(8);
    expect(out.getDate()).toBe(17);
  });

  it("pushes a too-late result to the next morning", () => {
    // 23:00 + 1h = midnight, past a 22:00 close → next day at 08:00.
    const out = resumeAtFor(
      { kind: "delay", seconds: 3600, window: { fromHour: 8, toHour: 22 } },
      at(23),
      LOCAL,
    );
    expect(out.getHours()).toBe(8);
    expect(out.getDate()).toBe(18);
  });

  it("handles an overnight window", () => {
    // 22–6 window: 2am is inside it, so no adjustment.
    const out = resumeAtFor(
      { kind: "delay", seconds: 3600, window: { fromHour: 22, toHour: 6 } },
      at(1),
      LOCAL,
    );
    expect(out.getHours()).toBe(2);
  });

  it("reads the window on the account's clock, not the server's", () => {
    // 06:00Z + 1h = 07:00Z. In São Paulo (UTC-3) that is 04:00, before an
    // 8–22 window, so the flow waits until 08:00 there — 11:00Z. In Tokyo
    // (UTC+9) the same instant is 16:00, inside the window, so it stands.
    // Neither answer depends on where this test happens to run.
    const now = new Date("2026-08-17T06:00:00Z");
    const window = { fromHour: 8, toHour: 22 };

    const saoPaulo = resumeAtFor({ kind: "delay", seconds: 3600, window }, now, "America/Sao_Paulo");
    expect(saoPaulo.toISOString()).toBe("2026-08-17T11:00:00.000Z");

    const tokyo = resumeAtFor({ kind: "delay", seconds: 3600, window }, now, "Asia/Tokyo");
    expect(tokyo.toISOString()).toBe("2026-08-17T07:00:00.000Z");
  });

  it("rolls to the next day in the account's zone, across the UTC date line", () => {
    // 23:30 in São Paulo on the 17th is 02:30Z on the 18th. Past a 22:00
    // close, so: 08:00 São Paulo on the 18th = 11:00Z on the 18th, not the 19th.
    const now = new Date("2026-08-18T02:00:00Z");
    const out = resumeAtFor(
      { kind: "delay", seconds: 1800, window: { fromHour: 8, toHour: 22 } },
      now,
      "America/Sao_Paulo",
    );
    expect(out.toISOString()).toBe("2026-08-18T11:00:00.000Z");
  });
});

import { describe, it, expect } from "vitest";
import {
  buildMessage, buildQuickReply, buildCarousel, buildImage,
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

describe("previewOf", () => {
  it("summarises payloads that carry no text", () => {
    expect(previewOf({
      kind: "carousel",
      cards: [{ id: "a", title: "Básico" }, { id: "b", title: "Pro" }],
    })).toBe("[carrossel: Básico, Pro]");
    expect(previewOf({ kind: "image", url: "https://x/y.png" })).toBe("[imagem]");
  });
});

describe("resumeAtFor", () => {
  const at = (h: number) => new Date(2026, 7, 17, h, 0, 0);

  it("adds the delay when no window is set", () => {
    const out = resumeAtFor({ kind: "delay", seconds: 3600 }, at(10));
    expect(out.getHours()).toBe(11);
  });

  it("leaves a time already inside the window alone", () => {
    const out = resumeAtFor(
      { kind: "delay", seconds: 3600, window: { fromHour: 8, toHour: 22 } },
      at(10),
    );
    expect(out.getHours()).toBe(11);
  });

  it("pushes a too-early result forward to the window opening", () => {
    // 3am + 1h = 4am, before an 8:00 window → waits until 8:00 same day.
    const out = resumeAtFor(
      { kind: "delay", seconds: 3600, window: { fromHour: 8, toHour: 22 } },
      at(3),
    );
    expect(out.getHours()).toBe(8);
    expect(out.getDate()).toBe(17);
  });

  it("pushes a too-late result to the next morning", () => {
    // 23:00 + 1h = midnight, past a 22:00 close → next day at 08:00.
    const out = resumeAtFor(
      { kind: "delay", seconds: 3600, window: { fromHour: 8, toHour: 22 } },
      at(23),
    );
    expect(out.getHours()).toBe(8);
    expect(out.getDate()).toBe(18);
  });

  it("handles an overnight window", () => {
    // 22–6 window: 2am is inside it, so no adjustment.
    const out = resumeAtFor(
      { kind: "delay", seconds: 3600, window: { fromHour: 22, toHour: 6 } },
      at(1),
    );
    expect(out.getHours()).toBe(2);
  });
});

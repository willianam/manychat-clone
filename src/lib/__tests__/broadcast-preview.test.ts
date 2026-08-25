import { describe, expect, it } from "vitest";
import { contentIssues, previewGraph } from "../broadcast-preview";

describe("previewGraph", () => {
  it("wraps plain text in a one-node message graph", () => {
    const g = previewGraph({ mode: "text", text: "Oi!" });
    expect(g?.nodes).toHaveLength(1);
    expect(g?.nodes[0]).toMatchObject({ type: "message", data: { kind: "message", text: "Oi!" } });
    expect(g?.edges).toEqual([]);
  });

  it("fills an empty text with a placeholder so the phone still draws", () => {
    const g = previewGraph({ mode: "text", text: "   " });
    expect((g?.nodes[0]?.data as { text: string }).text.length).toBeGreaterThan(0);
  });

  it("fills blank card titles and option titles in a block", () => {
    const g = previewGraph({
      mode: "content",
      content: { kind: "carousel", cards: [{ id: "c1", title: "" }] },
    });
    expect((g?.nodes[0]?.data as { cards: Array<{ title: string }> }).cards[0]?.title).toBe(
      "Card 1",
    );

    const q = previewGraph({
      mode: "content",
      content: { kind: "quickreply", text: "", saveAs: "x", options: [{ id: "o", title: " " }] },
    });
    expect((q?.nodes[0]?.data as { options: Array<{ title: string }> }).options[0]?.title).toBe(
      "Opção 1",
    );
  });

  it("passes a flow graph through untouched, and null when the flow has none", () => {
    const graph = {
      nodes: [
        { id: "a", type: "end" as const, position: { x: 0, y: 0 }, data: { kind: "end" as const } },
      ],
      edges: [],
    };
    expect(previewGraph({ mode: "flow", graph })).toBe(graph);
    expect(previewGraph({ mode: "flow", graph: null })).toBeNull();
  });
});

describe("contentIssues", () => {
  it("is empty for a sendable block", () => {
    expect(contentIssues({ kind: "message", text: "Olá" })).toEqual([]);
  });

  it("names the field and translates the reason", () => {
    const issues = contentIssues({ kind: "message", text: "" });
    expect(issues).toEqual(["texto: não pode ficar vazio"]);
  });

  it("points at the card and the field inside a carousel", () => {
    const issues = contentIssues({
      kind: "carousel",
      cards: [{ id: "c1", title: "ok", imageUrl: "nope" }],
    });
    expect(issues).toEqual(["cards #1 imagem: precisa ser um endereço https válido"]);
  });

  it("rejects a kind that does not send", () => {
    const issues = contentIssues({ kind: "end" });
    expect(issues[0]).toMatch(/precisa de um bloco que envia/);
  });
});

import { describe, it, expect } from "vitest";
import { previewFrom } from "../flow-preview";
import type { FlowGraph } from "../flow-schema";

/** message → quickreply(A/B) → two different endings. */
const graph: FlowGraph = {
  nodes: [
    { id: "m1", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "Olá!" } },
    {
      id: "q1",
      type: "quickreply",
      position: { x: 0, y: 0 },
      data: {
        kind: "quickreply",
        text: "Qual plano?",
        saveAs: "plano",
        options: [
          { id: "oA", title: "Básico" },
          { id: "oB", title: "Pro" },
        ],
      },
    },
    { id: "mA", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "Básico: R$97" } },
    { id: "mB", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "Pro: R$297" } },
    { id: "end", type: "end", position: { x: 0, y: 0 }, data: { kind: "end" } },
  ],
  edges: [
    { id: "e1", source: "m1", target: "q1" },
    { id: "e2", source: "q1", target: "mA", sourceHandle: "oA" },
    { id: "e3", source: "q1", target: "mB", sourceHandle: "oB" },
    { id: "e4", source: "mA", target: "end" },
  ],
};

describe("previewFrom", () => {
  it("walks from the entry node and stops at the first choice", () => {
    const items = previewFrom(graph);
    expect(items.map((i) => i.kind)).toEqual(["bubble", "quickreply"]);
    expect(items[0]).toMatchObject({ text: "Olá!" });
  });

  it("follows the branch the reviewer picks", () => {
    const items = previewFrom(graph, { q1: "oB" });
    const texts = items.flatMap((i) => (i.kind === "bubble" ? [i.text] : []));
    expect(texts).toEqual(["Olá!", "Pro: R$297"]);
  });

  it("reaches the end node on the wired branch", () => {
    const items = previewFrom(graph, { q1: "oA" });
    expect(items.at(-1)!.kind).toBe("end");
  });

  it("flags a branch that leads nowhere instead of ending silently", () => {
    // mB has no outgoing edge.
    const items = previewFrom(graph, { q1: "oB" });
    expect(items.at(-1)!.kind).toBe("dangling");
  });

  it("marks unwired and external choices so dead ends are visible", () => {
    const g: FlowGraph = {
      nodes: [
        {
          id: "m1",
          type: "message",
          position: { x: 0, y: 0 },
          data: {
            kind: "message",
            text: "Escolha",
            buttons: [
              { type: "postback", id: "b1", title: "Ligado" },
              { type: "postback", id: "b2", title: "Solto" },
              { type: "url", id: "b3", title: "Site", url: "https://x.com" },
            ],
          },
        },
        { id: "end", type: "end", position: { x: 0, y: 0 }, data: { kind: "end" } },
      ],
      edges: [{ id: "e1", source: "m1", target: "end", sourceHandle: "b1" }],
    };

    const items = previewFrom(g);
    const bubble = items[0] as Extract<ReturnType<typeof previewFrom>[number], { kind: "bubble" }>;
    expect(bubble.buttons.map((b) => [b.label, b.target, b.external ?? false])).toEqual([
      ["Ligado", "end", false],
      ["Solto", null, false],
      ["Site", null, true],
    ]);
  });

  it("presents a condition as a fork rather than evaluating it", () => {
    const g: FlowGraph = {
      nodes: [
        { id: "c1", type: "condition", position: { x: 0, y: 0 }, data: { kind: "condition", key: "nome", op: "exists" } },
        { id: "y", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "sim!" } },
        { id: "n", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "não!" } },
      ],
      edges: [
        { id: "e1", source: "c1", target: "y", sourceHandle: "true" },
        { id: "e2", source: "c1", target: "n", sourceHandle: "false" },
      ],
    };

    expect(previewFrom(g)[0]!.kind).toBe("fork");
    const picked = previewFrom(g, { c1: "false" });
    expect(picked.some((i) => i.kind === "bubble" && i.text === "não!")).toBe(true);
  });

  it("shows silent nodes as notes, not as messages", () => {
    const g: FlowGraph = {
      nodes: [
        { id: "d1", type: "delay", position: { x: 0, y: 0 }, data: { kind: "delay", seconds: 3600 } },
        { id: "end", type: "end", position: { x: 0, y: 0 }, data: { kind: "end" } },
      ],
      edges: [{ id: "e1", source: "d1", target: "end" }],
    };
    const items = previewFrom(g);
    expect(items[0]).toMatchObject({ kind: "note", text: "Espera 1h" });
  });

  it("renders the new media kinds", () => {
    const g: FlowGraph = {
      nodes: [
        { id: "a1", type: "album", position: { x: 0, y: 0 }, data: { kind: "album", urls: ["https://x/1.jpg", "https://x/2.jpg"] } },
        { id: "v1", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", url: "https://x/v.mp4" } },
        { id: "end", type: "end", position: { x: 0, y: 0 }, data: { kind: "end" } },
      ],
      edges: [
        { id: "e1", source: "a1", target: "v1" },
        { id: "e2", source: "v1", target: "end" },
      ],
    };
    const items = previewFrom(g);
    expect(items[0]).toMatchObject({ kind: "media", media: "album", label: "2 imagens" });
    expect(items[1]).toMatchObject({ kind: "media", media: "video" });
  });

  it("stops rather than spinning on a cycle", () => {
    const g: FlowGraph = {
      nodes: [
        { id: "a", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "a" } },
        { id: "b", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "b" } },
      ],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
    };
    // No entry node in a closed loop, so nothing is emitted at all.
    expect(previewFrom(g, {}, "a").length).toBeLessThanOrEqual(50);
  });
});

import { describe, expect, it } from "vitest";
import {
  duplicateNode,
  inlineLimitOf,
  inlineTextOf,
  pruneOrphanEdges,
  reindexGraph,
  removeNode,
  retypeButton,
  starterGraph,
  withInlineText,
} from "../flow-edit";
import { FlowGraph, LIMITS, validateGraph } from "../flow-schema";

/**
 * These cover the two invariants the editor depends on: option/button ids are
 * edge handles and must survive an edit, and an output that disappears must
 * take its edges with it.
 */

const quickReplyGraph = (): FlowGraph => ({
  nodes: [
    {
      id: "q1",
      type: "quickreply",
      position: { x: 0, y: 0 },
      data: {
        kind: "quickreply",
        text: "Escolha:",
        saveAs: "escolha",
        options: [
          { id: "opt-a", title: "A" },
          { id: "opt-b", title: "B" },
        ],
      },
    },
    { id: "e1", type: "end", position: { x: 0, y: 200 }, data: { kind: "end" } },
    { id: "e2", type: "end", position: { x: 200, y: 200 }, data: { kind: "end" } },
  ],
  edges: [
    { id: "x1", source: "q1", target: "e1", sourceHandle: "opt-a" },
    { id: "x2", source: "q1", target: "e2", sourceHandle: "opt-b" },
  ],
});

describe("pruneOrphanEdges", () => {
  it("keeps edges whose handle still exists", () => {
    const g = quickReplyGraph();
    expect(pruneOrphanEdges(g).edges).toHaveLength(2);
  });

  it("drops the edge of a removed quick-reply option", () => {
    const g = quickReplyGraph();
    const node = g.nodes[0]!;
    if (node.data.kind !== "quickreply") throw new Error("fixture");

    // Remove option B, as the properties panel would.
    node.data = { ...node.data, options: node.data.options.filter((o) => o.id !== "opt-b") };

    const pruned = pruneOrphanEdges(g);
    expect(pruned.edges.map((e) => e.id)).toEqual(["x1"]);
  });

  it("drops edges pointing at a node that no longer exists", () => {
    const g = quickReplyGraph();
    g.nodes = g.nodes.filter((n) => n.id !== "e2");
    expect(pruneOrphanEdges(g).edges.map((e) => e.id)).toEqual(["x1"]);
  });

  it("keeps handle-less edges from nodes with a single default output", () => {
    const g: FlowGraph = {
      nodes: [
        {
          id: "m1",
          type: "message",
          position: { x: 0, y: 0 },
          data: { kind: "message", text: "oi" },
        },
        { id: "e1", type: "end", position: { x: 0, y: 100 }, data: { kind: "end" } },
      ],
      edges: [{ id: "x1", source: "m1", target: "e1" }],
    };
    expect(pruneOrphanEdges(g).edges).toHaveLength(1);
  });

  it("drops a button's edge when the button becomes a url button", () => {
    const g: FlowGraph = {
      nodes: [
        {
          id: "m1",
          type: "message",
          position: { x: 0, y: 0 },
          data: {
            kind: "message",
            text: "oi",
            buttons: [{ type: "postback", id: "b1", title: "Quero" }],
          },
        },
        { id: "e1", type: "end", position: { x: 0, y: 100 }, data: { kind: "end" } },
      ],
      edges: [{ id: "x1", source: "m1", target: "e1", sourceHandle: "b1" }],
    };

    const node = g.nodes[0]!;
    if (node.data.kind !== "message") throw new Error("fixture");
    // A url button exposes no handle, so its edge can no longer route.
    node.data = { ...node.data, buttons: [retypeButton(node.data.buttons![0]!, "url")] };

    expect(pruneOrphanEdges(g).edges).toHaveLength(0);
  });
});

describe("retypeButton", () => {
  it("preserves the id across a type change, so the edge can survive", () => {
    const b = { type: "postback", id: "b1", title: "Quero" } as const;
    const url = retypeButton(b, "url");
    expect(url.id).toBe("b1");
    expect(url.title).toBe("Quero");

    const back = retypeButton(url, "postback");
    expect(back.id).toBe("b1");
    expect(back.type).toBe("postback");
  });

  it("is a no-op when the type already matches", () => {
    const b = { type: "postback", id: "b1", title: "Quero" } as const;
    expect(retypeButton(b, "postback")).toBe(b);
  });
});

describe("removeNode", () => {
  it("removes the node and every edge touching it", () => {
    const g = removeNode(quickReplyGraph(), "e1");
    expect(g.nodes.map((n) => n.id)).toEqual(["q1", "e2"]);
    expect(g.edges.map((e) => e.id)).toEqual(["x2"]);
  });
});

describe("inline text", () => {
  it("round-trips the primary text of each editable kind", () => {
    const message = { kind: "message", text: "oi" } as const;
    expect(inlineTextOf(message)).toBe("oi");
    expect(withInlineText(message, "tchau")).toMatchObject({ text: "tchau" });

    const tag = { kind: "tag", action: "add", tagName: "lead" } as const;
    expect(inlineTextOf(tag)).toBe("lead");
    expect(withInlineText(tag, "cliente")).toMatchObject({ tagName: "cliente" });
  });

  it("has no inline text for structural kinds", () => {
    expect(inlineTextOf({ kind: "end" })).toBeNull();
    expect(inlineTextOf({ kind: "condition", key: "nome", op: "exists" })).toBeNull();
  });

  it("caps a message with buttons at the button-template limit", () => {
    expect(inlineLimitOf({ kind: "message", text: "oi" })).toBe(LIMITS.messageText);
    expect(
      inlineLimitOf({
        kind: "message",
        text: "oi",
        buttons: [{ type: "postback", id: "b1", title: "x" }],
      }),
    ).toBe(LIMITS.buttonTemplateText);
  });
});

describe("starterGraph", () => {
  it("is valid, runnable and free of blocking issues", () => {
    const g = starterGraph();
    const parsed = FlowGraph.parse(g);
    expect(validateGraph(parsed).filter((i) => i.level === "error")).toEqual([]);
  });

  it("has an entry node wired to an end", () => {
    const g = starterGraph();
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.source).toBe(g.nodes[0]!.id);
    expect(g.edges[0]!.target).toBe(g.nodes[1]!.id);
  });
});

describe("reindexGraph", () => {
  it("re-keys every id while keeping the graph wired the same way", () => {
    const g = quickReplyGraph();
    const copy = reindexGraph(g);

    // No id is shared with the original.
    const before = new Set(g.nodes.map((n) => n.id));
    for (const n of copy.nodes) expect(before.has(n.id)).toBe(false);

    // The shape survives: same node count, same edge count, still valid.
    expect(copy.nodes).toHaveLength(g.nodes.length);
    expect(copy.edges).toHaveLength(g.edges.length);
    expect(validateGraph(FlowGraph.parse(copy)).filter((i) => i.level === "error")).toEqual([]);

    // Edges still leave from a handle the source node actually exposes.
    expect(pruneOrphanEdges(copy).edges).toHaveLength(g.edges.length);
  });

  it("re-keys carousel cards and their buttons", () => {
    const g: FlowGraph = {
      nodes: [
        {
          id: "c1",
          type: "carousel",
          position: { x: 0, y: 0 },
          data: {
            kind: "carousel",
            cards: [
              {
                id: "card-1",
                title: "Card",
                buttons: [{ type: "postback", id: "btn-1", title: "Quero" }],
              },
            ],
          },
        },
        { id: "e1", type: "end", position: { x: 0, y: 100 }, data: { kind: "end" } },
      ],
      edges: [{ id: "x1", source: "c1", target: "e1", sourceHandle: "btn-1" }],
    };

    const copy = reindexGraph(g);
    const card = copy.nodes[0]!;
    if (card.data.kind !== "carousel") throw new Error("fixture");

    expect(card.data.cards[0]!.id).not.toBe("card-1");
    const newButtonId = card.data.cards[0]!.buttons![0]!.id;
    expect(newButtonId).not.toBe("btn-1");
    // The edge was rewritten to follow the button's new id.
    expect(copy.edges[0]!.sourceHandle).toBe(newButtonId);
  });
});

describe("duplicateNode", () => {
  const graph = FlowGraph.parse({
    nodes: [
      {
        id: "m1",
        type: "message",
        position: { x: 100, y: 200 },
        data: {
          kind: "message",
          text: "Escolha:",
          buttons: [
            { type: "postback", id: "b1", title: "Sim" },
            { type: "url", id: "b2", title: "Site", url: "https://x.com" },
          ],
        },
      },
      { id: "e1", type: "end", position: { x: 0, y: 400 }, data: { kind: "end" } },
    ],
    edges: [{ id: "ed1", source: "m1", target: "e1", sourceHandle: "b1" }],
  });

  it("adiciona um nó com id novo", () => {
    const out = duplicateNode(graph, "m1");
    expect(out.nodes).toHaveLength(3);
    const copy = out.nodes[2]!;
    expect(copy.id).not.toBe("m1");
    expect(copy.data).toMatchObject({ kind: "message", text: "Escolha:" });
  });

  it("re-emite os ids dos botões, senão dois nós disputariam o mesmo handle", () => {
    const copy = duplicateNode(graph, "m1").nodes[2]!;
    const btns = (copy.data as { buttons: Array<{ id: string; title: string }> }).buttons;
    expect(btns.map((b) => b.id)).not.toContain("b1");
    expect(btns.map((b) => b.id)).not.toContain("b2");
    // O conteúdo é preservado; só a identidade muda.
    expect(btns.map((b) => b.title)).toEqual(["Sim", "Site"]);
  });

  it("não copia aresta nenhuma — herdar saídas duplicaria o fluxo inteiro", () => {
    const out = duplicateNode(graph, "m1");
    expect(out.edges).toEqual(graph.edges);
  });

  it("desloca a cópia para ela não ficar escondida sob a original", () => {
    const copy = duplicateNode(graph, "m1").nodes[2]!;
    expect(copy.position).toEqual({ x: 140, y: 260 });
  });

  it("re-emite ids de card e de opção também", () => {
    const g = FlowGraph.parse({
      nodes: [
        {
          id: "c1",
          type: "carousel",
          position: { x: 0, y: 0 },
          data: {
            kind: "carousel",
            cards: [
              { id: "card1", title: "A", buttons: [{ type: "postback", id: "cb1", title: "Ok" }] },
            ],
          },
        },
        {
          id: "q1",
          type: "quickreply",
          position: { x: 0, y: 1 },
          data: {
            kind: "quickreply",
            text: "?",
            saveAs: "k",
            options: [{ id: "o1", title: "Um" }],
          },
        },
      ],
      edges: [],
    });

    const card = duplicateNode(g, "c1").nodes[2]!.data as {
      cards: Array<{ id: string; buttons: Array<{ id: string }> }>;
    };
    expect(card.cards[0]!.id).not.toBe("card1");
    expect(card.cards[0]!.buttons[0]!.id).not.toBe("cb1");

    const qr = duplicateNode(g, "q1").nodes[2]!.data as { options: Array<{ id: string }> };
    expect(qr.options[0]!.id).not.toBe("o1");
  });

  it("devolve o grafo intacto quando o nó não existe", () => {
    expect(duplicateNode(graph, "fantasma")).toEqual(graph);
  });
});

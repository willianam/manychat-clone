import { describe, expect, it } from "vitest";
import { layoutGraph } from "../flow-layout";
import type { FlowGraph } from "../flow-schema";

const node = (id: string, data: object): FlowGraph["nodes"][number] => ({
  id,
  type: (data as { kind: FlowGraph["nodes"][number]["type"] }).kind,
  position: { x: 999, y: 999 },
  data: data as FlowGraph["nodes"][number]["data"],
});

const graph: FlowGraph = {
  nodes: [
    node("start", { kind: "message", text: "Oi" }),
    node("cond", { kind: "condition", key: "nome", op: "exists" }),
    node("yes", { kind: "message", text: "Sim" }),
    node("no", { kind: "message", text: "Não" }),
    node("end", { kind: "end" }),
  ],
  edges: [
    { id: "e1", source: "start", target: "cond" },
    // Deliberately wired "não" first: the layout must still put "sim" on the left.
    { id: "e3", source: "cond", target: "no", sourceHandle: "false" },
    { id: "e2", source: "cond", target: "yes", sourceHandle: "true" },
    { id: "e4", source: "yes", target: "end" },
    { id: "e5", source: "no", target: "end" },
  ],
};

const pos = (g: FlowGraph, id: string) => g.nodes.find((n) => n.id === id)!.position;

describe("layoutGraph", () => {
  it("lays the flow out top-down, one rank per depth", () => {
    const out = layoutGraph(graph);
    expect(pos(out, "start").y).toBeLessThan(pos(out, "cond").y);
    expect(pos(out, "cond").y).toBeLessThan(pos(out, "yes").y);
    expect(pos(out, "yes").y).toBe(pos(out, "no").y);
    expect(pos(out, "yes").y).toBeLessThan(pos(out, "end").y);
    // Data and edges untouched.
    expect(out.edges).toEqual(graph.edges);
    expect(out.nodes.map((n) => n.data)).toEqual(graph.nodes.map((n) => n.data));
  });

  it("keeps the handle order left to right (sim before não)", () => {
    const out = layoutGraph(graph);
    expect(pos(out, "yes").x).toBeLessThan(pos(out, "no").x);
  });

  it("survives cycles and self-loops", () => {
    const cyclic: FlowGraph = {
      nodes: [node("a", { kind: "message", text: "a" }), node("b", { kind: "message", text: "b" })],
      edges: [
        { id: "1", source: "a", target: "b" },
        { id: "2", source: "b", target: "a" },
        { id: "3", source: "a", target: "a" },
      ],
    };
    const out = layoutGraph(cyclic);
    expect(out.nodes.every((n) => Number.isFinite(n.position.x))).toBe(true);
    expect(pos(out, "a")).not.toEqual(pos(out, "b"));
  });
});

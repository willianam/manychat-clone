import { describe, expect, it } from "vitest";
import {
  CLIPBOARD_PREFIX,
  clipSelection,
  parseClip,
  pasteClip,
  serializeClip,
} from "../flow-clipboard";
import type { FlowGraph } from "../flow-schema";

const graph: FlowGraph = {
  nodes: [
    {
      id: "m1",
      type: "message",
      position: { x: 0, y: 0 },
      data: {
        kind: "message",
        text: "Oi",
        buttons: [{ type: "postback", id: "b1", title: "Vai" }],
      },
    },
    {
      id: "m2",
      type: "message",
      position: { x: 0, y: 200 },
      data: { kind: "message", text: "Tchau" },
    },
    { id: "e1", type: "end", position: { x: 0, y: 400 }, data: { kind: "end" } },
  ],
  edges: [
    { id: "x1", source: "m1", target: "m2", sourceHandle: "b1" },
    { id: "x2", source: "m2", target: "e1" },
  ],
};

describe("flow clipboard", () => {
  it("copies the selection and only the edges between selected nodes", () => {
    const clip = clipSelection(graph, ["m1", "m2"])!;
    expect(clip.nodes.map((n) => n.id)).toEqual(["m1", "m2"]);
    expect(clip.edges.map((e) => e.id)).toEqual(["x1"]);
    expect(clipSelection(graph, ["nope"])).toBeNull();
  });

  it("round-trips through text with the prefix and rejects anything else", () => {
    const clip = clipSelection(graph, ["m1"])!;
    const text = serializeClip(clip);
    expect(text.startsWith(CLIPBOARD_PREFIX)).toBe(true);
    expect(parseClip(text)).toEqual(clip);
    expect(parseClip("hello")).toBeNull();
    expect(parseClip(CLIPBOARD_PREFIX + "{not json")).toBeNull();
    expect(parseClip(CLIPBOARD_PREFIX + '{"nodes":[],"edges":[]}')).toBeNull();
  });

  it("pastes with fresh ids, remapped handles and an offset", () => {
    const clip = clipSelection(graph, ["m1", "m2"])!;
    const { graph: next, added } = pasteClip(graph, clip);
    expect(next.nodes.length).toBe(5);
    expect(added.length).toBe(2);
    expect(added.some((id) => id === "m1" || id === "m2")).toBe(false);

    const copy = next.nodes.find((n) => n.id === added[0])!;
    expect(copy.position).toEqual({ x: 40, y: 40 });
    const button = (copy.data as { buttons: Array<{ id: string }> }).buttons[0]!;
    expect(button.id).not.toBe("b1");

    const edge = next.edges.find((e) => e.source === added[0])!;
    expect(edge.target).toBe(added[1]);
    expect(edge.sourceHandle).toBe(button.id);
    // Nothing points back into the original nodes.
    expect(next.edges.filter((e) => e.source === added[1]).length).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { renameTagInGraph, graphUsesTag } from "../tag-rename";

/**
 * Renaming a tag must touch tag references and nothing else. The old
 * implementation replaced the name everywhere in the serialized graph, so
 * renaming the tag "oi" rewrote every message that said "oi".
 */

const GRAPH = {
  nodes: [
    // The trap: a message whose text is exactly the tag name.
    { id: "m1", data: { kind: "message", text: "oi" } },
    { id: "m2", data: { kind: "message", text: "oi, tudo bem? oi!" } },
    { id: "t1", data: { kind: "tag", action: "add", tagName: "oi" } },
    { id: "t2", data: { kind: "tag", action: "add", tagName: "outra" } },
    {
      id: "a1",
      data: {
        kind: "action",
        ops: [
          { op: "addTag", tagName: "oi" },
          { op: "removeTag", tagName: "outra" },
          { op: "setField", key: "nota", value: "oi" },
        ],
      },
    },
    { id: "c1", data: { kind: "condition", key: "oi", op: "hasTag" } },
    { id: "c2", data: { kind: "condition", key: "oi", op: "equals", value: "oi" } },
    {
      id: "c3",
      data: {
        kind: "condition",
        key: "x",
        op: "exists",
        rules: [
          { key: "oi", op: "notHasTag" },
          { key: "oi", op: "contains", value: "oi" },
        ],
      },
    },
  ],
  edges: [],
};

const nodeById = (g: unknown, id: string) =>
  (g as { nodes: Array<{ id: string; data: Record<string, unknown> }> }).nodes.find(
    (n) => n.id === id,
  )!.data;

describe("renameTagInGraph", () => {
  const { graph, changed } = renameTagInGraph(GRAPH, "oi", "ola");

  it("renames every real tag reference", () => {
    expect(nodeById(graph, "t1").tagName).toBe("ola");
    expect((nodeById(graph, "a1").ops as Array<Record<string, unknown>>)[0]!.tagName).toBe("ola");
    expect(nodeById(graph, "c1").key).toBe("ola");
    expect((nodeById(graph, "c3").rules as Array<Record<string, unknown>>)[0]!.key).toBe("ola");
    // tag node + addTag op + hasTag key + notHasTag rule key
    expect(changed).toBe(4);
  });

  it("leaves message copy that merely contains the name untouched", () => {
    expect(nodeById(graph, "m1").text).toBe("oi");
    expect(nodeById(graph, "m2").text).toBe("oi, tudo bem? oi!");
    // A setField value is data, not a tag reference.
    expect((nodeById(graph, "a1").ops as Array<Record<string, unknown>>)[2]!.value).toBe("oi");
  });

  it("leaves non-tag condition operands untouched", () => {
    // op "equals" on key "oi" is a context key, not a tag.
    expect(nodeById(graph, "c2").key).toBe("oi");
    expect(nodeById(graph, "c2").value).toBe("oi");
    expect((nodeById(graph, "c3").rules as Array<Record<string, unknown>>)[1]!.key).toBe("oi");
  });

  it("leaves other tags alone and does not mutate the input", () => {
    expect(nodeById(graph, "t2").tagName).toBe("outra");
    expect(nodeById(GRAPH, "t1").tagName).toBe("oi");
  });

  it("reports no change when the tag is absent", () => {
    expect(renameTagInGraph(GRAPH, "inexistente", "x").changed).toBe(0);
  });
});

describe("graphUsesTag", () => {
  it("sees a real reference, not a coincidental substring", () => {
    expect(graphUsesTag(GRAPH, "oi")).toBe(true);
    expect(graphUsesTag(GRAPH, "outra")).toBe(true);
    expect(graphUsesTag({ nodes: [{ data: { kind: "message", text: "oi" } }] }, "oi")).toBe(false);
  });
});

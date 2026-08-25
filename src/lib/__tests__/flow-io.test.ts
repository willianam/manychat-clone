import { describe, it, expect } from "vitest";
import { serializeFlow, parseFlowFile, exportFilename, FLOW_FILE_VERSION } from "../flow-io";
import type { FlowGraph } from "../flow-schema";

const runnable: FlowGraph = {
  nodes: [
    { id: "m1", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "Oi" } },
    { id: "e1", type: "end", position: { x: 0, y: 100 }, data: { kind: "end" } },
  ],
  edges: [{ id: "ed1", source: "m1", target: "e1" }],
};

describe("export / import round trip", () => {
  it("re-imports exactly what it exported", () => {
    const res = parseFlowFile(serializeFlow("Meu fluxo", runnable));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.file.name).toBe("Meu fluxo");
    expect(res.file.version).toBe(FLOW_FILE_VERSION);
    expect(res.file.graph).toEqual(runnable);
  });
});

describe("import rejects bad files with a specific reason", () => {
  it("rejects text that is not JSON", () => {
    const res = parseFlowFile("not json {");
    expect(res).toEqual({ ok: false, error: "O arquivo não é um JSON válido." });
  });

  it("rejects a JSON file that is not one of ours", () => {
    const res = parseFlowFile(JSON.stringify({ hello: "world" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("Este arquivo não é um fluxo exportado por aqui.");
  });

  it("rejects one of ours whose graph fails the schema", () => {
    const bad = JSON.stringify({
      kind: "manychat-clone/flow",
      version: 1,
      name: "Quebrado",
      // A message node with no text cannot exist.
      graph: {
        nodes: [{ id: "a", type: "message", position: { x: 0, y: 0 }, data: { kind: "message" } }],
        edges: [],
      },
    });
    const res = parseFlowFile(bad);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("inválido");
  });

  it("rejects a graph that parses but could not run", () => {
    // Every node is an edge target, so there is no entry node — a closed loop.
    const cyclic = JSON.stringify({
      kind: "manychat-clone/flow",
      version: 1,
      name: "Ciclo",
      graph: {
        nodes: [
          {
            id: "a",
            type: "message",
            position: { x: 0, y: 0 },
            data: { kind: "message", text: "a" },
          },
          {
            id: "b",
            type: "message",
            position: { x: 0, y: 0 },
            data: { kind: "message", text: "b" },
          },
        ],
        edges: [
          { id: "e1", source: "a", target: "b" },
          { id: "e2", source: "b", target: "a" },
        ],
      },
    });
    const res = parseFlowFile(cyclic);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("não pode rodar");
  });

  it("refuses a file from a newer version rather than guessing", () => {
    const future = JSON.stringify({
      kind: "manychat-clone/flow",
      version: FLOW_FILE_VERSION + 1,
      name: "Futuro",
      graph: runnable,
    });
    const res = parseFlowFile(future);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("versão mais nova");
  });

  it("passes structural warnings through without blocking", () => {
    const dangling: FlowGraph = {
      nodes: [
        {
          id: "m1",
          type: "message",
          position: { x: 0, y: 0 },
          data: { kind: "message", text: "Oi" },
        },
      ],
      edges: [],
    };
    const res = parseFlowFile(serializeFlow("Solto", dangling));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings.length).toBeGreaterThan(0);
  });
});

describe("exportFilename", () => {
  it("strips accents and punctuation into a safe slug", () => {
    expect(exportFilename("Promoção de Março!")).toBe("fluxo-promocao-de-marco.json");
  });

  it("falls back when the name has nothing usable", () => {
    expect(exportFilename("!!!")).toBe("fluxo-sem-nome.json");
  });
});

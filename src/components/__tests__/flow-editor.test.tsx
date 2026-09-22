// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FlowEditor } from "../FlowEditor";
import type { FlowGraph } from "../../lib/flow-schema";
import { isUnsaved, setUnsaved } from "../../lib/ui/unsaved";

/**
 * React Flow measures the canvas; jsdom reports zero and warns. The warning is
 * noise here — this file tests the editor's state, not its layout.
 */
beforeAll(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  if (!("requestAnimationFrame" in window)) {
    // @ts-expect-error jsdom without rAF
    window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
  }
});

afterEach(() => {
  cleanup();
  setUnsaved(false);
});

const graph: FlowGraph = {
  nodes: [
    { id: "m1", type: "message", position: { x: 0, y: 0 }, data: { kind: "message", text: "Oi" } },
    { id: "m2", type: "message", position: { x: 0, y: 120 }, data: { kind: "message", text: "Tudo bem?" } },
  ],
  edges: [{ id: "e1", source: "m1", target: "m2" }],
} as unknown as FlowGraph;

function setup() {
  const onSave = vi.fn(async () => {});
  render(
    <FlowEditor
      initial={graph}
      onSave={onSave}
      draft={{
        hasDraft: false,
        publishedAt: "2026-09-01T12:00:00.000Z",
        onPublish: async () => {},
        onDiscard: async () => {},
      }}
    />,
  );
  return { onSave };
}

describe("FlowEditor — marcar alterações não salvas", () => {
  it("uma edição marca o rascunho como sujo sem estourar a pilha", () => {
    setup();
    expect(screen.queryByText("rascunho com alterações")).toBeNull();

    // "Organizar" é o caminho de edição mais simples que termina em touch().
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Organizar" }))).not.toThrow();

    expect(screen.getByText("rascunho com alterações")).toBeTruthy();
  });

  it("a edição liga o sinalizador app-wide de trabalho não salvo", () => {
    setup();
    expect(isUnsaved()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Organizar" }));

    expect(isUnsaved()).toBe(true);
  });
});

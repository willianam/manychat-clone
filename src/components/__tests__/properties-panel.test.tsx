// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Node } from "reactflow";
import { PropertiesPanel, type GotoTargets } from "../PropertiesPanel";
import type { FlowNodeData } from "../../lib/flow-schema";

afterEach(cleanup);

const targets: GotoTargets = {
  nodes: [
    { id: "self", label: "Este (self)" },
    { id: "m2", label: "Texto: Oi (m2)" },
  ],
  flows: [{ id: "f9", name: "Boas-vindas" }],
};

function setup(data: FlowNodeData, id = "self") {
  const onChange = vi.fn();
  render(
    <PropertiesPanel
      node={{ id, type: data.kind, position: { x: 0, y: 0 }, data } as Node}
      targets={targets}
      onChange={onChange}
      onDelete={() => {}}
      onClose={() => {}}
    />,
  );
  return { onChange };
}

const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0] as FlowNodeData;

describe("PropertiesPanel · question", () => {
  it("edits the validation fields and keeps the rest", () => {
    const { onChange } = setup({ kind: "question", text: "Nome?", saveAs: "nome" });
    fireEvent.click(screen.getByLabelText(/Permitir pular/));
    expect(last(onChange)).toMatchObject({ kind: "question", saveAs: "nome", allowSkip: true });

    fireEvent.change(screen.getByPlaceholderText("nome"), { target: { value: "primeiro_nome" } });
    expect(last(onChange)).toMatchObject({ saveAs: "primeiro_nome" });

    fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "20" } });
    expect(last(onChange)).toMatchObject({ maxAttempts: 10 });
  });

  it("lists the accepted options for an option question", () => {
    const { onChange } = setup({
      kind: "question",
      text: "Tamanho?",
      saveAs: "tamanho",
      inputType: "option",
      options: ["P", "M"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar opção" }));
    expect(last(onChange)).toMatchObject({ options: ["P", "M", ""] });
  });
});

describe("PropertiesPanel · condition", () => {
  it("adds a second rule and mirrors the first into key/op/value", () => {
    const { onChange } = setup({ kind: "condition", key: "nome", op: "exists" });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar regra" }));
    expect(last(onChange)).toEqual({
      kind: "condition",
      key: "nome",
      op: "exists",
      value: undefined,
      rules: [
        { key: "nome", op: "exists", value: undefined },
        { key: "", op: "exists" },
      ],
      combinator: "and",
    });
  });

  it("collapses back to a single rule when one is removed", () => {
    const { onChange } = setup({
      kind: "condition",
      key: "a",
      op: "exists",
      rules: [
        { key: "a", op: "exists" },
        { key: "b", op: "equals", value: "1" },
      ],
      combinator: "or",
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[0]!);
    expect(last(onChange)).toMatchObject({
      key: "b",
      op: "equals",
      value: "1",
      rules: undefined,
      combinator: undefined,
    });
  });
});

describe("PropertiesPanel · random", () => {
  it("names an arm without touching the weights", () => {
    const { onChange } = setup({ kind: "random", weights: [50, 50] });
    fireEvent.change(screen.getByLabelText("Nome da saída 2"), { target: { value: "Longa" } });
    expect(last(onChange)).toEqual({ kind: "random", weights: [50, 50], labels: ["", "Longa"] });
  });
});

describe("PropertiesPanel · goto and request", () => {
  it("offers the other steps, never the node itself", () => {
    setup({ kind: "goto", target: { nodeId: "m2" } });
    expect(screen.getByText("Texto: Oi (m2)")).toBeTruthy();
    expect(screen.queryByText("Este (self)")).toBeNull();
  });

  it("shows the flow selector for a flow target", () => {
    setup({ kind: "goto", target: { flowId: "f9" } });
    expect(screen.getByText("Boas-vindas")).toBeTruthy();
  });

  it("adds headers and mappings, dropping empty lists", () => {
    const { onChange } = setup({
      kind: "request",
      method: "GET",
      url: "https://x.test",
      headers: [{ name: "A", value: "1" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar campo" }));
    expect(last(onChange)).toMatchObject({ mapping: [{ path: "", field: "" }] });
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(last(onChange)).toMatchObject({ headers: undefined });
  });
});

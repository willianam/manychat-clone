// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const actions = vi.hoisted(() => ({
  createSegmentAction: vi.fn(async () => undefined),
  updateSegmentAction: vi.fn(async () => undefined),
}));
vi.mock("../actions", () => actions);
const preview = vi.hoisted(() => ({ countSegmentAction: vi.fn(async () => 7) }));
vi.mock("../preview-action", () => preview);

import { SegmentBuilder } from "../SegmentBuilder";

const ctx = {
  tags: [{ id: "t-vip", name: "vip" }],
  fields: [{ key: "total", label: "Total" }],
};

beforeEach(() => {
  preview.countSegmentAction.mockClear();
  actions.createSegmentAction.mockClear();
});

describe("SegmentBuilder", () => {
  it("starts empty, counts everyone, and adds a tag rule by default", async () => {
    render(<SegmentBuilder ctx={ctx} debounceMs={0} />);
    expect(screen.getByText(/Sem regras, o segmento é todo mundo/)).toBeTruthy();
    await waitFor(() =>
      expect(preview.countSegmentAction).toHaveBeenCalledWith({ combinator: "and", rules: [] }),
    );
    await waitFor(() => expect(screen.getByText("7")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Adicionar regra" }));
    expect(screen.getByRole("combobox", { name: "Tipo da regra 1" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Etiqueta da regra 1" }).textContent).toContain(
      "vip",
    );
    await waitFor(() =>
      expect(preview.countSegmentAction).toHaveBeenLastCalledWith({
        combinator: "and",
        rules: [{ kind: "tag", op: "has", value: "t-vip" }],
      }),
    );
  });

  it("debounces the live count", async () => {
    vi.useFakeTimers();
    try {
      render(<SegmentBuilder ctx={ctx} debounceMs={400} />);
      expect(preview.countSegmentAction).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(399);
      });
      expect(preview.countSegmentAction).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(preview.countSegmentAction).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("edits an existing segment and saves name + rules through the update action", async () => {
    render(
      <SegmentBuilder
        ctx={ctx}
        debounceMs={0}
        segment={{
          id: "s1",
          name: "Quentes",
          rules: {
            combinator: "or",
            rules: [
              { kind: "window", op: "in" },
              { kind: "source", op: "startsWith", value: "ref:" },
            ],
          },
        }}
      />,
    );
    const name = screen.getByLabelText("Nome") as HTMLInputElement;
    expect(name.value).toBe("Quentes");
    const source = screen.getByRole("textbox", { name: "Valor da regra 2" }) as HTMLInputElement;
    expect(source.value).toBe("ref:");
    fireEvent.change(source, { target: { value: "ref:promo" } });
    fireEvent.click(screen.getByRole("button", { name: "Remover regra 1" }));
    fireEvent.change(name, { target: { value: "Promo" } });
    const save = screen.getByRole("button", { name: "Salvar segmento" }) as HTMLButtonElement;
    console.log(
      "DBG",
      name.closest("form")!.textContent,
      "|name=",
      name.value,
      "|src=",
      (screen.queryByRole("textbox", { name: "Valor da regra 1" }) as HTMLInputElement | null)
        ?.value,
    );
    expect(save.disabled).toBe(false);
    fireEvent.submit(name.closest("form")!);
    await waitFor(() =>
      expect(actions.updateSegmentAction).toHaveBeenCalledWith("s1", "Promo", {
        combinator: "or",
        rules: [{ kind: "source", op: "startsWith", value: "ref:promo" }],
      }),
    );
  });

  it("blocks saving while a rule is incomplete", async () => {
    render(<SegmentBuilder ctx={{ tags: [], fields: [] }} debounceMs={0} />);
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar regra" }));
    expect(screen.getByText(/Complete as regras/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Criar segmento" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BlockEditor, blankBlock, type Block } from "../BlockEditor";

afterEach(cleanup);

function setup(initial: Block) {
  const onChange = vi.fn();
  render(<BlockEditor value={initial} onChange={onChange} />);
  return { onChange };
}

describe("BlockEditor", () => {
  it("edits the message text and reports the new block", () => {
    const { onChange } = setup(blankBlock("message"));
    fireEvent.change(screen.getByLabelText("Texto"), { target: { value: "Olá" } });
    expect(onChange).toHaveBeenLastCalledWith({ kind: "message", text: "Olá" });
  });

  it("adds a url button to a message, up to the Instagram cap", () => {
    const three = {
      kind: "message" as const,
      text: "x",
      buttons: [1, 2, 3].map((i) => ({
        type: "url" as const,
        id: `b${i}`,
        title: `B${i}`,
        url: "https://x.y",
      })),
    };
    const { onChange } = setup({ kind: "message", text: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar botão" }));
    const next = onChange.mock.calls.at(-1)?.[0] as Extract<Block, { kind: "message" }>;
    expect(next.buttons).toHaveLength(1);
    expect(next.buttons?.[0]?.type).toBe("url");

    cleanup();
    setup(three);
    expect(
      (screen.getByRole("button", { name: "Adicionar botão" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps at least one quick reply option", () => {
    setup(blankBlock("quickreply"));
    expect(
      (screen.getByRole("button", { name: "Remover opção 1" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("removes a carousel card when more than one exists", () => {
    const { onChange } = setup({
      kind: "carousel",
      cards: [
        { id: "c1", title: "Um" },
        { id: "c2", title: "Dois" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Remover card 1" }));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: "carousel",
      cards: [{ id: "c2", title: "Dois" }],
    });
  });

  it("drops the buttons key when the last button is removed", () => {
    const { onChange } = setup({
      kind: "message",
      text: "x",
      buttons: [{ type: "url", id: "b1", title: "Ir", url: "https://x.y" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Remover botão 1" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "message", text: "x" });
  });
});

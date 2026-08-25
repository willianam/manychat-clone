// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);
import { ConfirmDialog } from "../ui/confirm-dialog";

function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      title="Excluir o fluxo?"
      description="Isso não pode ser desfeito."
      confirmLabel="Excluir"
      destructive
      {...props}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe("ConfirmDialog", () => {
  it("renders as an alertdialog with title and description", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    const title = screen.getByText("Excluir o fluxo?");
    expect(dialog.getAttribute("aria-labelledby")).toBe(title.id);
    expect(screen.getByText("Isso não pode ser desfeito.")).toBeTruthy();
  });

  it("calls onConfirm without closing by itself", () => {
    const { onConfirm, onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("cancel closes and does not confirm", () => {
    const { onConfirm, onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Escape closes the dialog", () => {
    const { onOpenChange } = setup();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("locks both buttons while pending", () => {
    setup({ pending: true });
    expect((screen.getByRole("button", { name: /Excluir/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isUnsaved, setUnsaved } from "../../lib/ui/unsaved";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { GuardedLink } from "../ui/guarded-link";

afterEach(() => {
  cleanup();
  setUnsaved(false);
  push.mockClear();
});

describe("GuardedLink", () => {
  it("is a plain link when nothing is unsaved", () => {
    render(<GuardedLink href="/flows">Fluxos</GuardedLink>);
    const a = screen.getByRole("link", { name: "Fluxos" });
    expect(a.getAttribute("href")).toBe("/flows");
    fireEvent.click(a);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks first when there are unsaved changes, and leaves on confirm", () => {
    setUnsaved(true);
    render(<GuardedLink href="/flows">Fluxos</GuardedLink>);
    fireEvent.click(screen.getByRole("link", { name: "Fluxos" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(push).toHaveBeenCalledWith("/flows");
    expect(isUnsaved()).toBe(false);
  });

  it("stays put on cancel", () => {
    setUnsaved(true);
    render(<GuardedLink href="/flows">Fluxos</GuardedLink>);
    fireEvent.click(screen.getByRole("link", { name: "Fluxos" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar editando" }));
    expect(push).not.toHaveBeenCalled();
    expect(isUnsaved()).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../app/flows/[id]/actions", () => ({
  searchContacts: vi.fn(),
  testFlowOnContact: vi.fn(),
}));

import { toast } from "sonner";
import { TestFlowDialog } from "../TestFlowDialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const contacts = [
  { id: "c1", username: "maria", name: "Maria" },
  { id: "c2", username: "mariana", name: null },
];

function setup(start = vi.fn().mockResolvedValue({ ok: true })) {
  const search = vi.fn().mockResolvedValue(contacts);
  const onClose = vi.fn();
  render(
    <TestFlowDialog open flowId="f1" hasDraft onClose={onClose} search={search} start={start} />,
  );
  return { search, start, onClose };
}

describe("TestFlowDialog", () => {
  it("searches by username, requires a pick, confirms, then starts the flow", async () => {
    const { search, start, onClose } = setup();

    expect(screen.getByText(/O teste roda a versão publicada/)).toBeTruthy();
    const go = screen.getByRole("button", { name: "Iniciar teste" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Buscar contato por username"), {
      target: { value: "@mar" },
    });
    await waitFor(() => expect(search).toHaveBeenCalledWith("@mar"));
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["@mariaMaria", "@mariana"]);

    fireEvent.click(radios[1]!);
    expect(go.disabled).toBe(false);
    fireEvent.click(go);

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Iniciar agora" }));
    });
    expect(start).toHaveBeenCalledWith("f1", "c2");
    expect(toast.success).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces the server's reason when the flow cannot start", async () => {
    const start = vi.fn().mockResolvedValue({ ok: false, error: "Ative o fluxo antes de testar." });
    const { onClose } = setup(start);
    fireEvent.change(screen.getByLabelText("Buscar contato por username"), {
      target: { value: "maria" },
    });
    fireEvent.click((await screen.findAllByRole("radio"))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar teste" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Iniciar agora" }));
    });
    expect(toast.error).toHaveBeenCalledWith("Não foi possível iniciar o teste.", {
      description: "Ative o fluxo antes de testar.",
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../app/broadcasts/actions", () => ({
  searchBroadcastTestContacts: vi.fn(),
  testBroadcast: vi.fn(),
}));

import { toast } from "sonner";
import { TestBroadcastDialog } from "../../app/broadcasts/TestBroadcastDialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const contacts = [
  { id: "c1", username: "maria", name: "Maria" },
  { id: "c2", username: "eu", name: null },
];

const DRAFT = { text: "promo de sexta", content: null, flowId: null, tag: null };

function setup(send = vi.fn().mockResolvedValue({ ok: true })) {
  const search = vi.fn().mockResolvedValue(contacts);
  const onClose = vi.fn();
  const onSent = vi.fn();
  render(
    <TestBroadcastDialog
      open
      onClose={onClose}
      draft={() => DRAFT}
      onSent={onSent}
      search={search}
      send={send}
    />,
  );
  return { search, send, onClose, onSent };
}

async function pickAndConfirm(label = "Enviar teste") {
  fireEvent.change(screen.getByLabelText("Buscar contato para o teste"), {
    target: { value: "@eu" },
  });
  const radios = await screen.findAllByRole("radio");
  fireEvent.click(radios[1]!);
  fireEvent.click(screen.getByRole("button", { name: label }));
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: label }).at(-1)!);
  });
}

describe("TestBroadcastDialog", () => {
  it("sends the composed draft to the picked contact and says it was a test", async () => {
    const { search, send, onClose, onSent } = setup();

    expect(screen.getByText(/A lista de destinatários não é tocada/)).toBeTruthy();
    const go = screen.getByRole("button", { name: "Enviar teste" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);

    await waitFor(() => expect(screen.getByLabelText("Buscar contato para o teste")).toBeTruthy());
    await pickAndConfirm();

    expect(search).toHaveBeenCalledWith("@eu");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(DRAFT, "c2");
    expect(toast.success).toHaveBeenCalledWith(
      "Teste enviado para @eu. Nenhum contato da lista recebeu.",
    );
    expect(onSent).toHaveBeenCalledWith(contacts[1]);
    expect(onClose).toHaveBeenCalled();
  });

  it("asks for confirmation before anything leaves", async () => {
    const { send } = setup();
    fireEvent.change(screen.getByLabelText("Buscar contato para o teste"), {
      target: { value: "maria" },
    });
    fireEvent.click((await screen.findAllByRole("radio"))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Enviar teste" }));

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("shows the server's sentence and keeps the dialog open when the test fails", async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, error: "Fora da janela de 24h." });
    const { onClose, onSent } = setup(send);
    await pickAndConfirm();

    expect(toast.error).toHaveBeenCalledWith("Fora da janela de 24h.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

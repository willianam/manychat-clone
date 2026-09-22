// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../actions", () => ({
  createBroadcast: vi.fn(),
  testBroadcast: vi.fn().mockResolvedValue({ ok: true }),
  searchBroadcastTestContacts: vi.fn().mockResolvedValue([
    { id: "c9", username: "eu", name: "Eu" },
  ]),
}));
vi.mock("../AudiencePicker", () => ({ AudiencePicker: () => null }));
vi.mock("../../flows/[id]/preview/PreviewPhone", () => ({ PreviewPhone: () => null }));

import { Composer } from "../Composer";
import { createBroadcast, testBroadcast } from "../actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * The property that matters: a test send is not a broadcast.
 *
 * The test button lives inside the composer's <form>, one tab away from
 * "Enviar agora". If it ever submitted that form, a rehearsal would become
 * the real thing — so this walks the whole path and asserts `createBroadcast`
 * was never called.
 */
describe("Composer test send", () => {
  it("never submits the broadcast form: the test goes through testBroadcast alone", async () => {
    render(<Composer tags={[]} segments={[]} flows={[]} timeZone="America/Sao_Paulo" />);

    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "promo de sexta" } });
    fireEvent.click(screen.getByRole("button", { name: /Enviar um teste/ }));

    fireEvent.change(screen.getByLabelText("Buscar contato para o teste"), {
      target: { value: "@eu" },
    });
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar teste" }));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Enviar teste" }).at(-1)!);
    });

    expect(testBroadcast).toHaveBeenCalledWith(
      { text: "promo de sexta", content: null, flowId: null, tag: null },
      "c9",
    );
    expect(createBroadcast).not.toHaveBeenCalled();

    // And it says so on screen, after the toast is gone.
    expect(screen.getByText(/Último teste enviado para @eu/)).toBeTruthy();
    expect(screen.getByText(/nenhum contato da lista recebeu/)).toBeTruthy();
  });

  it("offers no test while there is nothing composed", () => {
    render(<Composer tags={[]} segments={[]} flows={[]} timeZone="America/Sao_Paulo" />);
    const btn = screen.getByRole("button", { name: /Enviar um teste/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

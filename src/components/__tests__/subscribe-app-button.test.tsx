// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../app/configuracoes/actions", () => ({ subscribeWebhookApp: vi.fn() }));

import { toast } from "sonner";
import { SubscribeAppButton } from "../../app/configuracoes/SubscribeAppButton";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SubscribeAppButton", () => {
  it("confirma a inscrição quando a Meta aceita", async () => {
    const subscribe = vi.fn().mockResolvedValue({ ok: true, fields: ["messages"] });
    render(<SubscribeAppButton subscribe={subscribe} />);

    fireEvent.click(screen.getByRole("button", { name: /inscrever esta conta/i }));

    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Conta inscrita")),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("mostra a frase acionável da falha, não um 'falhou' genérico", async () => {
    const subscribe = vi.fn().mockResolvedValue({
      ok: false,
      error:
        "O token não tem a permissão necessária. Ele precisa de instagram_business_manage_messages.",
    });
    render(<SubscribeAppButton subscribe={subscribe} />);

    fireEvent.click(screen.getByRole("button", { name: /inscrever esta conta/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("instagram_business_manage_messages"),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});

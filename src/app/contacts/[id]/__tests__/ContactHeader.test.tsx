// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const actions = vi.hoisted(() => ({ setSubscribed: vi.fn(async () => undefined) }));
vi.mock("../../actions", () => actions);

import { ContactHeader, WindowCountdown } from "../ContactHeader";

const NOW = new Date("2026-08-25T12:00:00Z");
const H = 3_600_000;

describe("WindowCountdown", () => {
  it("shows the remaining time inside the window", () => {
    render(
      <WindowCountdown
        lastInboundAt={new Date(NOW.getTime() - 10 * H - 40 * 60_000).toISOString()}
        now={NOW}
      />,
    );
    expect(screen.getByText("dentro da janela")).toBeTruthy();
    expect(screen.getByText("faltam 13h 20min")).toBeTruthy();
  });

  it("says never / outside otherwise", () => {
    const { unmount } = render(<WindowCountdown lastInboundAt={null} now={NOW} />);
    expect(screen.getByText("nunca escreveu")).toBeTruthy();
    unmount();
    render(
      <WindowCountdown lastInboundAt={new Date(NOW.getTime() - 40 * H).toISOString()} now={NOW} />,
    );
    expect(screen.getByText("fora da janela")).toBeTruthy();
    expect(screen.queryByText(/faltam/)).toBeNull();
  });
});

describe("ContactHeader", () => {
  it("toggles the subscription through the action", async () => {
    render(
      <ContactHeader
        contact={{
          id: "c1",
          name: "Ana",
          username: "ana",
          profilePic: null,
          source: "ref:promo",
          subscribed: true,
          lastInboundAt: null,
          createdAt: NOW.toISOString(),
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Ana");
    expect(screen.getByText(/origem: ref:promo/)).toBeTruthy();
    const sw = screen.getByRole("switch", { name: "Inscrito" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(actions.setSubscribed).toHaveBeenCalledWith("c1", false));
    expect(screen.getByText("Descadastrado")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../actions", () => ({
  replyAction: vi.fn().mockResolvedValue(undefined),
  createQuickReplyAction: vi.fn(),
  deleteQuickReplyAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { replyAction } from "../actions";
import { ReplyBox } from "../ReplyBox";

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(replyAction).mockClear();
  vi.mocked(replyAction).mockResolvedValue(undefined);
  refresh.mockClear();
});

const QUICK = [
  {
    id: "q1",
    title: "Preço",
    text: "O valor é R$ 100.",
    shortcut: "preco",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "q2",
    title: "Horário",
    text: "Atendemos das 9h às 18h.",
    shortcut: "horario",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];
const OPEN = { open: true, remainingMs: 2 * 3_600_000 + 5 * 60_000, humanAgentOpen: true };
const CLOSED = { open: false, remainingMs: 0, humanAgentOpen: true };
const DEAD = { open: false, remainingMs: 0, humanAgentOpen: false };

function box(w = OPEN) {
  render(<ReplyBox contactId="c1" window={w} quickReplies={QUICK} />);
  return screen.getByRole("textbox", { name: "Resposta" }) as HTMLTextAreaElement;
}

describe("ReplyBox", () => {
  it("shows the window counter", () => {
    box();
    expect(screen.getByRole("status").textContent).toContain("Janela fecha em 2h 05min");
  });

  it("sends on Enter and ⌘Enter, and keeps ⇧Enter as a line break", async () => {
    const ta = box();
    fireEvent.change(ta, { target: { value: "oi" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(replyAction).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter" });
    });
    expect(replyAction).toHaveBeenCalledWith("c1", { text: "oi", humanAgent: false });
    expect(ta.value).toBe("");
    expect(refresh).toHaveBeenCalledTimes(1);

    fireEvent.change(ta, { target: { value: "de novo" } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    });
    expect(replyAction).toHaveBeenCalledTimes(2);
  });

  it("does not send an empty reply", async () => {
    const ta = box();
    fireEvent.change(ta, { target: { value: "   " } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter" });
    });
    expect(replyAction).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("keeps the text and toasts when the send fails", async () => {
    vi.mocked(replyAction).mockRejectedValueOnce(new Error("A janela de 24h fechou."));
    const ta = box();
    fireEvent.change(ta, { target: { value: "oi" } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter" });
    });
    expect(toast.error).toHaveBeenCalled();
    expect(ta.value).toBe("oi");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens the quick-reply picker on '/', filters, and inserts with Enter", () => {
    const ta = box();
    fireEvent.change(ta, { target: { value: "/" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.change(ta, { target: { value: "/hor" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toBe("Atendemos das 9h às 18h.");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(replyAction).not.toHaveBeenCalled();
  });

  it("moves through suggestions with the arrows and closes with Escape", () => {
    const ta = box();
    fireEvent.change(ta, { target: { value: "/" } });
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(ta, { key: "Tab" });
    expect(ta.value).toBe("Atendemos das 9h às 18h.");

    fireEvent.change(ta, { target: { value: "/x" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(ta, { target: { value: "/" } });
    fireEvent.keyDown(ta, { key: "Escape" });
    // Escape closes the picker and KEEPS the draft — it used to clear it.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(ta.value).toBe("/");
  });

  it("Escape does not discard a draft, and typing reopens the picker", () => {
    const ta = box();
    fireEvent.change(ta, { target: { value: "/pre" } });
    expect(screen.queryByRole("listbox")).not.toBeNull();

    fireEvent.keyDown(ta, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(ta.value).toBe("/pre");

    // A dismissal applies to that query only, not to the picker forever.
    fireEvent.change(ta, { target: { value: "/prec" } });
    expect(screen.queryByRole("listbox")).not.toBeNull();
  });

  it("outside the 24h window, requires the human-agent mark before sending", async () => {
    const ta = box(CLOSED);
    expect(screen.getByRole("status").textContent).toContain("Janela de 24h fechada");
    fireEvent.change(ta, { target: { value: "oi" } });
    const send = screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /Atendimento humano/ }));
    expect(send.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(send);
    });
    expect(replyAction).toHaveBeenCalledWith("c1", { text: "oi", humanAgent: true });
  });

  it("locks the composer after 7 days", () => {
    const ta = box(DEAD);
    expect(ta.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("mais de 7 dias");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

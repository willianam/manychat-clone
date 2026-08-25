// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../actions", () => ({
  markReadAction: vi.fn().mockResolvedValue(undefined),
  setPausedAction: vi.fn().mockResolvedValue(undefined),
  replyAction: vi.fn(),
  createQuickReplyAction: vi.fn(),
  deleteQuickReplyAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { markReadAction, setPausedAction } from "../actions";
import { Thread } from "../Thread";
import { NOW, contact, h, message, thread } from "./fixtures";

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(markReadAction).mockClear();
  vi.mocked(setPausedAction).mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});

function mount(t = thread()) {
  render(<Thread thread={t} quickReplies={[]} backHref="/inbox" olderHref={null} now={NOW} />);
}

describe("Thread", () => {
  it("renders the bubbles, the header and marks the thread read when it has unread inbound", async () => {
    await act(async () => mount());
    expect(screen.getByRole("log", { name: "Mensagens" })).toBeTruthy();
    expect(screen.getByText("olá!")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ana Souza" })).toBeTruthy();
    expect(screen.getByText("janela aberta")).toBeTruthy();
    expect(markReadAction).toHaveBeenCalledWith("c1");
  });

  it("does not mark read when everything inbound is older than the read mark", async () => {
    await act(async () =>
      mount(
        thread({
          contact: contact({ lastReadAt: h(0.5) }),
          messages: [message({ createdAt: h(1) })],
        }),
      ),
    );
    expect(markReadAction).not.toHaveBeenCalled();
  });

  it("names the active flow and its node, and pauses automation from the banner", async () => {
    await act(async () =>
      mount(
        thread({
          activeFlow: {
            sessionId: "s1",
            flowId: "f1",
            flowName: "Boas-vindas",
            status: "WAITING_INPUT",
            nodeId: "q1",
            nodeLabel: "pergunta: “Qual sua cidade?”",
          },
        }),
      ),
    );
    const banner = screen.getByRole("status", { name: "Automação" });
    expect(banner.textContent).toContain("Boas-vindas");
    expect(banner.textContent).toContain("aguardando resposta em pergunta: “Qual sua cidade?”");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Pausar automação/ }));
    });
    expect(setPausedAction).toHaveBeenCalledWith("c1", true);
    expect(refresh).toHaveBeenCalled();
  });

  it("offers to resume when paused", async () => {
    await act(async () => mount(thread({ contact: contact({ automationPaused: true }) })));
    expect(screen.getByRole("status", { name: "Automação" }).textContent).toContain(
      "Automação pausada",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retomar automação/ }));
    });
    expect(setPausedAction).toHaveBeenCalledWith("c1", false);
  });

  it("links to older messages when there are more", () => {
    render(
      <Thread
        thread={thread()}
        quickReplies={[]}
        backHref="/inbox"
        olderHref="/inbox?c=c1&before=x"
        now={NOW}
      />,
    );
    expect(screen.getByRole("link", { name: "Carregar anteriores" }).getAttribute("href")).toBe(
      "/inbox?c=c1&before=x",
    );
  });
});

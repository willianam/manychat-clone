// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ConversationList } from "../ConversationList";
import { NOW, h, row } from "./fixtures";

afterEach(cleanup);

describe("ConversationList", () => {
  it("renders rows newest first with preview, time, unread badge and paused marker", () => {
    render(
      <ConversationList
        items={[
          row("a", {
            unread: 3,
            preview: { text: "tem estoque?", direction: "INBOUND", status: "DELIVERED", at: h(1) },
          }),
          row("b", {
            automationPaused: true,
            lastMessageAt: h(30),
            preview: { text: "R$ 10", direction: "OUTBOUND", status: "SENT", at: h(30) },
          }),
        ]}
        filter="all"
        q=""
        nextCursor={null}
        now={NOW}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    const a = within(items[0]!);
    expect(a.getByText("Pessoa a")).toBeTruthy();
    expect(a.getByText("tem estoque?")).toBeTruthy();
    expect(a.getByLabelText("3 não lidas").textContent).toBe("3");
    expect(a.getByText("1 h")).toBeTruthy();
    expect(a.getByRole("link").getAttribute("data-unread")).toBe("true");

    const b = within(items[1]!);
    expect(b.getByText("Você:")).toBeTruthy();
    expect(b.getByLabelText("Automação pausada")).toBeTruthy();
    expect(b.getByText("1 d")).toBeTruthy();
    expect(b.queryByLabelText(/não lidas/)).toBeNull();
  });

  it("links rows and filters through the URL, keeping the search and selection", () => {
    render(
      <ConversationList
        items={[row("a"), row("b")]}
        filter="unread"
        q="ana"
        selectedId="b"
        nextCursor="2026-08-27T10:00:00.000Z"
        now={NOW}
      />,
    );
    const selected = screen.getByRole("link", { name: /Pessoa b/ });
    expect(selected.getAttribute("aria-current")).toBe("true");
    expect(selected.getAttribute("href")).toBe("/inbox?filter=unread&q=ana&c=b");

    const nav = screen.getByRole("navigation", { name: "Filtro" });
    const active = within(nav).getByRole("link", { name: "Não lidas" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Pausadas" }).getAttribute("href")).toBe(
      "/inbox?filter=paused&q=ana&c=b",
    );
    expect(within(nav).getByRole("link", { name: "Todas" }).getAttribute("href")).toBe(
      "/inbox?q=ana&c=b",
    );

    expect(screen.getByRole("link", { name: "Carregar mais" }).getAttribute("href")).toBe(
      "/inbox?filter=unread&q=ana&c=b&cursor=2026-08-27T10%3A00%3A00.000Z",
    );
    expect(
      (screen.getByRole("searchbox", { name: "Buscar conversas" }) as HTMLInputElement).value,
    ).toBe("ana");
  });

  it("shows an empty state, worded for a search when there is one", () => {
    render(<ConversationList items={[]} filter="all" q="" nextCursor={null} now={NOW} />);
    expect(screen.getByText("Nenhuma conversa ainda.")).toBeTruthy();
    cleanup();
    render(<ConversationList items={[]} filter="all" q="zé" nextCursor={null} now={NOW} />);
    expect(screen.getByText("Nenhuma conversa encontrada.")).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const actions = vi.hoisted(() => ({
  bulkSetSubscribed: vi.fn(async () => undefined),
  bulkTag: vi.fn(async () => 2),
  bulkStartFlow: vi.fn(async () => ({ started: 1, skipped: 1 })),
  exportSelectionCsv: vi.fn(async () => "a,b\r\n"),
}));
vi.mock("../actions", () => actions);

import { ContactsTable, type ContactListRow } from "../ContactsTable";
import { parseContactQuery } from "@/lib/contact-query";

const rows: ContactListRow[] = [
  {
    id: "c1",
    name: "Ana",
    username: "ana",
    profilePic: null,
    tags: [{ id: "t1", name: "vip", color: "#312e81" }],
    lastInboundLabel: "25/08/2026, 09:00",
    window: "in",
    windowLabel: "dentro · 21h",
    subscribed: true,
    source: "dm",
  },
  {
    id: "c2",
    name: null,
    username: "bruno",
    profilePic: null,
    tags: [],
    lastInboundLabel: null,
    window: "never",
    windowLabel: "nunca escreveu",
    subscribed: false,
    source: null,
  },
];

function setup() {
  render(
    <ContactsTable
      rows={rows}
      query={parseContactQuery({})}
      tags={[{ id: "t1", name: "vip" }]}
      flows={[{ id: "f1", name: "Boas-vindas" }]}
    />,
  );
}

describe("ContactsTable", () => {
  it("renders one row per contact linking to its page, with window and subscription pills", () => {
    setup();
    expect(screen.getByRole("link", { name: /Ana/ }).getAttribute("href")).toBe("/contacts/c1");
    expect(screen.getByText("dentro · 21h")).toBeTruthy();
    expect(screen.getByText("nunca escreveu")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Ações em massa" })).toBeNull();
  });

  it("sort headers are links that flip the direction", () => {
    setup();
    const name = screen.getByRole("link", { name: /^Nome/ });
    expect(name.getAttribute("href")).toBe("/contacts?sort=name");
    const last = screen.getByRole("link", { name: /Última interação/ });
    expect(last.getAttribute("href")).toBe("/contacts?dir=asc");
  });

  it("selecting rows shows the bulk bar with the count; select-all covers the page", () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar Ana" }));
    expect(screen.getByRole("region", { name: "Ações em massa" }).textContent).toContain(
      "1 selecionado",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar todos da página" }));
    expect(screen.getByText("2 selecionados")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(screen.queryByRole("region", { name: "Ações em massa" })).toBeNull();
  });

  it("runs a bulk action with the selected ids, then clears and refreshes", async () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar todos da página" }));
    fireEvent.click(screen.getByRole("button", { name: "Descadastrar" }));

    // Opting people out in bulk asks first, and names the count.
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Descadastrar 2 contatos?");
    expect(actions.bulkSetSubscribed).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Descadastrar" }));
    await waitFor(() =>
      expect(actions.bulkSetSubscribed).toHaveBeenCalledWith(["c1", "c2"], false),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Ações em massa" })).toBeNull();
  });
});

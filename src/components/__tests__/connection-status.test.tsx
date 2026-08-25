// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConnectionStatus } from "../shell/connection-status";

afterEach(cleanup);

describe("ConnectionStatus", () => {
  it("paints the level and links to the settings", () => {
    render(<ConnectionStatus status={{ level: "warn", label: "atenção", detail: ["x"] }} />);
    const link = screen.getByRole("link", { name: "Conexão com o Instagram: atenção" });
    expect(link.getAttribute("href")).toBe("/configuracoes");
    expect(link.getAttribute("data-level")).toBe("warn");
    expect(link.className).toContain("amber");
  });

  it("uses the green style when everything is fine", () => {
    render(<ConnectionStatus status={{ level: "ok", label: "conectado", detail: [] }} />);
    expect(screen.getByRole("link").className).toContain("emerald");
  });
});

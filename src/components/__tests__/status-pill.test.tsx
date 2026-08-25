// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);
import { StatusPill } from "../ui/status-pill";

describe("StatusPill", () => {
  it("renders the label with the tone's classes", () => {
    render(<StatusPill tone="success">ativo</StatusPill>);
    const pill = screen.getByText("ativo");
    expect(pill.dataset.tone).toBe("success");
    expect(pill.className).toContain("text-emerald-700");
  });

  it("uses a different palette per tone", () => {
    render(
      <>
        <StatusPill tone="destructive">com erro</StatusPill>
        <StatusPill tone="warning">fluxo pausado</StatusPill>
        <StatusPill tone="neutral">pausado</StatusPill>
      </>,
    );
    expect(screen.getByText("com erro").className).toContain("text-rose-700");
    expect(screen.getByText("fluxo pausado").className).toContain("text-amber-700");
    expect(screen.getByText("pausado").className).toContain("text-neutral-700");
  });
});

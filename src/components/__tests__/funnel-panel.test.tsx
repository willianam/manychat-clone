// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FunnelPanel } from "../FunnelPanel";

afterEach(cleanup);

const funnel = {
  from: new Date("2026-08-01"),
  to: new Date("2026-08-31"),
  started: 10,
  completed: 4,
  abandoned: 3,
  inProgress: 3,
  goals: 2,
  nodes: [
    { nodeId: "m1", kind: "message", reached: 10 },
    { nodeId: "c1", kind: "condition", reached: 0 },
    { nodeId: "q1", kind: "question", reached: 4 },
  ],
};

describe("FunnelPanel", () => {
  it("shows outcomes and per-node reach relative to starts", () => {
    render(
      <FunnelPanel
        funnel={funnel}
        labels={{ m1: "Texto: Oi", q1: "Coleta: Nome?" }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Iniciados").nextSibling?.textContent).toBe("10");
    expect(screen.getByText("Conclusão").nextSibling?.textContent).toBe("40%");
    expect(screen.getByText("10 · 100%")).toBeTruthy();
    expect(screen.getByText("4 · 40%")).toBeTruthy();
    // Silent nodes show a dash instead of a misleading zero.
    expect(screen.getByText("c1").parentElement?.textContent).toContain("–");
  });

  it("says so when there is nothing", () => {
    render(<FunnelPanel funnel={null} labels={{}} onClose={() => {}} />);
    expect(screen.getByText("Sem dados para este período.")).toBeTruthy();
  });
});

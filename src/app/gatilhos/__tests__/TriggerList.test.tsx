// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../actions", () => ({
  createTrigger: vi.fn(),
  updateTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  setTriggerEnabled: vi.fn(),
}));
vi.mock("../../../components/MediaPicker", () => ({ MediaPicker: () => null }));

import { TriggerList, type TriggerRowData } from "../TriggerList";

afterEach(cleanup);

function row(over: Partial<TriggerRowData["trigger"]> & { fires7d?: number }): TriggerRowData {
  const { fires7d = 0, ...t } = over;
  return {
    mediaLabel: null,
    fires7d,
    trigger: {
      id: "t1",
      flowId: "f1",
      flowName: "Boas-vindas",
      flowEnabled: true,
      kind: "KEYWORD",
      pattern: "oi",
      match: "CONTAINS",
      mediaId: null,
      enabled: true,
      priority: 0,
      summary: "",
      ...t,
    },
  };
}

describe("TriggerList", () => {
  it("shows the 7-day fire count per trigger", () => {
    render(
      <TriggerList
        rows={[row({ id: "a", fires7d: 12 }), row({ id: "b", fires7d: 1 }), row({ id: "c" })]}
        flows={[{ id: "f1", name: "Boas-vindas" }]}
      />,
    );
    const counts = screen.getAllByTestId("fires7d").map((el) => el.textContent);
    expect(counts).toEqual([
      "12 disparos em 7 dias",
      "1 disparo em 7 dias",
      "sem disparos em 7 dias",
    ]);
  });

  it("labels a welcome trigger with its pt-BR name", () => {
    render(
      <TriggerList
        rows={[row({ kind: "WELCOME", pattern: null })]}
        flows={[{ id: "f1", name: "Boas-vindas" }]}
      />,
    );
    expect(screen.getByText("Primeira mensagem (boas-vindas)")).toBeTruthy();
  });
});

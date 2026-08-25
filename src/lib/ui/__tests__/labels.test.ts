import { describe, expect, it } from "vitest";
import {
  broadcastStatusLabel,
  broadcastStatusTone,
  labelFor,
  sessionStatusLabel,
  triggerKindLabel,
} from "../labels";

describe("labels", () => {
  it("translates every broadcast status", () => {
    expect(broadcastStatusLabel("DRAFT")).toBe("rascunho");
    expect(broadcastStatusLabel("QUEUED")).toBe("na fila");
    expect(broadcastStatusLabel("SENDING")).toBe("enviando");
    expect(broadcastStatusLabel("DONE")).toBe("concluído");
    expect(broadcastStatusLabel("FAILED")).toBe("falhou");
  });

  it("maps broadcast status to a pill tone", () => {
    expect(broadcastStatusTone("DONE")).toBe("success");
    expect(broadcastStatusTone("FAILED")).toBe("destructive");
    expect(broadcastStatusTone("WHATEVER")).toBe("neutral");
  });

  it("translates session statuses", () => {
    expect(sessionStatusLabel("WAITING_INPUT")).toBe("aguardando resposta");
    expect(sessionStatusLabel("ABANDONED")).toBe("abandonada");
  });

  it("reuses the trigger kind labels from trigger-rules", () => {
    expect(triggerKindLabel("KEYWORD")).not.toBe("KEYWORD");
    expect(triggerKindLabel("KEYWORD")).toMatch(/palavra/i);
  });

  it("never shows a raw enum for an unknown value", () => {
    expect(labelFor({ A: "a" }, "NEW_THING")).toBe("new thing");
  });
});

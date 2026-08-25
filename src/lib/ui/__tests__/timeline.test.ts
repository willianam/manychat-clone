import { describe, expect, it } from "vitest";
import { describeTimelineItem, toTimelineDto } from "../timeline";

const AT = "2026-08-25T12:00:00.000Z";

describe("describeTimelineItem", () => {
  it("labels messages by direction and flags failures with the error", () => {
    expect(
      describeTimelineItem({
        kind: "message",
        at: AT,
        id: "m",
        direction: "INBOUND",
        text: "oi",
        status: "SENT",
        error: null,
      }),
    ).toEqual({ text: "Recebida: oi", tone: "inbound" });
    expect(
      describeTimelineItem({
        kind: "message",
        at: AT,
        id: "m",
        direction: "OUTBOUND",
        text: "olá",
        status: "FAILED",
        error: "window",
      }),
    ).toEqual({ text: "Enviada (falhou: window): olá", tone: "failed" });
    expect(
      describeTimelineItem({
        kind: "message",
        at: AT,
        id: "m",
        direction: "OUTBOUND",
        text: null,
        status: "SENT",
        error: null,
      }).text,
    ).toBe("Enviada: (mensagem sem texto)");
  });

  it("labels flow runs and notes", () => {
    const base = { at: AT, id: "s", flowId: "f", flowName: "Quiz" } as const;
    expect(describeTimelineItem({ kind: "flow_started", ...base }).text).toBe(
      'Entrou no fluxo "Quiz"',
    );
    expect(describeTimelineItem({ kind: "flow_completed", ...base }).text).toBe(
      'Concluiu o fluxo "Quiz"',
    );
    expect(describeTimelineItem({ kind: "flow_abandoned", ...base }).text).toBe(
      'Saiu do fluxo "Quiz"',
    );
    expect(describeTimelineItem({ kind: "note", at: AT, id: "n", text: "cliente antigo" })).toEqual(
      {
        text: "cliente antigo",
        tone: "note",
      },
    );
  });

  it("translates events and their origin", () => {
    const ev = (event: string, payload: unknown) =>
      describeTimelineItem({ kind: "event", at: AT, id: "e", event: event as never, payload }).text;
    expect(ev("TAG_ADDED", { tagName: "vip", via: "flow" })).toBe(
      'Etiqueta "vip" adicionada (fluxo)',
    );
    expect(ev("TAG_REMOVED", { tagName: "vip", via: "panel" })).toBe(
      'Etiqueta "vip" removida (painel)',
    );
    expect(ev("UNSUBSCRIBED", { via: "keyword" })).toBe("Descadastrou-se (palavra-chave)");
    expect(ev("SUBSCRIBED", {})).toBe("Voltou a receber mensagens");
    expect(ev("FIELD_SET", { key: "cidade", value: "SP" })).toBe('Campo "cidade" = SP');
    expect(ev("FIELD_SET", { key: "cidade", value: "" })).toBe('Campo "cidade" limpo');
    expect(ev("SOMETHING_NEW", null)).toBe("something new");
  });

  it("serialises the date for the client", () => {
    const dto = toTimelineDto({ kind: "note", at: new Date(AT), id: "n", text: "x" });
    expect(dto.at).toBe(AT);
  });
});

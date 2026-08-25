import type { TimelineItem } from "../../server/contact-timeline";

/**
 * The timeline as the page shows it. Dates cross the server/client boundary
 * as ISO strings; `describeTimelineItem` turns each item into one line of
 * Portuguese so the client component only lays things out.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type TimelineItemDto = DistributiveOmit<TimelineItem, "at"> & { at: string };

export function toTimelineDto(item: TimelineItem): TimelineItemDto {
  return { ...item, at: item.at.toISOString() } as TimelineItemDto;
}

export type TimelineTone = "inbound" | "outbound" | "flow" | "note" | "event" | "failed";

export function describeTimelineItem(item: TimelineItemDto): { text: string; tone: TimelineTone } {
  switch (item.kind) {
    case "message": {
      const failed = item.status === "FAILED";
      const who = item.direction === "INBOUND" ? "Recebida" : "Enviada";
      const body = item.text?.trim() ? item.text : "(mensagem sem texto)";
      return {
        text: failed
          ? `${who} (falhou${item.error ? `: ${item.error}` : ""}): ${body}`
          : `${who}: ${body}`,
        tone: failed ? "failed" : item.direction === "INBOUND" ? "inbound" : "outbound",
      };
    }
    case "flow_started":
      return { text: `Entrou no fluxo "${item.flowName}"`, tone: "flow" };
    case "flow_completed":
      return { text: `Concluiu o fluxo "${item.flowName}"`, tone: "flow" };
    case "flow_abandoned":
      return { text: `Saiu do fluxo "${item.flowName}"`, tone: "flow" };
    case "note":
      return { text: item.text, tone: "note" };
    case "event":
      return { text: describeEvent(item.event, item.payload), tone: "event" };
  }
}

function describeEvent(kind: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const via = typeof p.via === "string" ? ` (${VIA[p.via] ?? p.via})` : "";
  switch (kind) {
    case "TAG_ADDED":
      return `Etiqueta "${p.tagName ?? "?"}" adicionada${via}`;
    case "TAG_REMOVED":
      return `Etiqueta "${p.tagName ?? "?"}" removida${via}`;
    case "SUBSCRIBED":
      return `Voltou a receber mensagens${via}`;
    case "UNSUBSCRIBED":
      return `Descadastrou-se${via}`;
    case "FIELD_SET":
      return p.value === "" || p.value === undefined
        ? `Campo "${p.key ?? "?"}" limpo`
        : `Campo "${p.key ?? "?"}" = ${String(p.value)}`;
    default:
      return kind.toLowerCase().replace(/_/g, " ");
  }
}

const VIA: Record<string, string> = {
  keyword: "palavra-chave",
  flow: "fluxo",
  panel: "painel",
  csv: "importação CSV",
};

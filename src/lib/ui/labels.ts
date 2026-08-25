import { KIND_LABEL, MATCH_LABEL, type TriggerKindName } from "../trigger-rules";
import type { StatusTone } from "@/components/ui/status-pill";

/**
 * pt-BR labels for the enums the UI shows.
 *
 * The database stores `DRAFT`, `QUEUED`, `WAITING_INPUT`; the owner reads
 * "rascunho", "na fila", "aguardando resposta". Every place that renders an
 * enum goes through here, so a new value gets one label, not one per page.
 */

export type BroadcastStatus = "DRAFT" | "QUEUED" | "SENDING" | "DONE" | "FAILED";
export type SessionStatus = "ACTIVE" | "WAITING_INPUT" | "COMPLETED" | "ABANDONED";

export const BROADCAST_STATUS_LABEL: Record<BroadcastStatus, string> = {
  DRAFT: "rascunho",
  QUEUED: "na fila",
  SENDING: "enviando",
  DONE: "concluído",
  FAILED: "falhou",
};

export const BROADCAST_STATUS_TONE: Record<BroadcastStatus, StatusTone> = {
  DRAFT: "neutral",
  QUEUED: "info",
  SENDING: "warning",
  DONE: "success",
  FAILED: "destructive",
};

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  ACTIVE: "ativa",
  WAITING_INPUT: "aguardando resposta",
  COMPLETED: "concluída",
  ABANDONED: "abandonada",
};

/** Trigger kinds already carry their labels in lib/trigger-rules; re-exported for one import site. */
export const TRIGGER_KIND_LABEL: Record<TriggerKindName, string> = KIND_LABEL;
export const TRIGGER_MATCH_LABEL = MATCH_LABEL;

/** Label for a value that may come from a newer schema than this build knows. */
export function labelFor<K extends string>(map: Record<K, string>, value: string): string {
  return (map as Record<string, string>)[value] ?? value.toLowerCase().replace(/_/g, " ");
}

export function broadcastStatusLabel(status: string): string {
  return labelFor(BROADCAST_STATUS_LABEL, status);
}

export function broadcastStatusTone(status: string): StatusTone {
  return (BROADCAST_STATUS_TONE as Record<string, StatusTone>)[status] ?? "neutral";
}

export function sessionStatusLabel(status: string): string {
  return labelFor(SESSION_STATUS_LABEL, status);
}

export function triggerKindLabel(kind: string): string {
  return labelFor(TRIGGER_KIND_LABEL, kind);
}

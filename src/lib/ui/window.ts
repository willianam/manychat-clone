import { WINDOW_MS } from "../messaging-window";

/**
 * The 24h window as the UI shows it: a state and a countdown.
 *
 * `canSend` (lib/messaging-window.ts) is the decision; this only formats it.
 * The list column, the contact header and the send dialog all read the same
 * three words, so "fora" means the same thing on every screen.
 */

export type WindowState = "in" | "out" | "never";

export function windowState(lastInboundAt: Date | null, now = new Date()): WindowState {
  if (!lastInboundAt) return "never";
  return now.getTime() - lastInboundAt.getTime() <= WINDOW_MS ? "in" : "out";
}

/** "13h 20min", "45min", "menos de 1min". */
export function formatRemaining(ms: number): string {
  if (ms < 60_000) return "menos de 1min";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export const WINDOW_LABEL: Record<WindowState, string> = {
  in: "dentro da janela",
  out: "fora da janela",
  never: "nunca escreveu",
};

/** Short label with the countdown when inside: "dentro · 13h 20min". */
export function windowSummary(lastInboundAt: Date | null, now = new Date()): string {
  const state = windowState(lastInboundAt, now);
  if (state !== "in") return WINDOW_LABEL[state];
  const remaining = WINDOW_MS - (now.getTime() - lastInboundAt!.getTime());
  return `dentro · ${formatRemaining(remaining)}`;
}

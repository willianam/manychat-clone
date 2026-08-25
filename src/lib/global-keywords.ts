import { normalizeText } from "./text-normalize";

/**
 * Keywords that mean something regardless of which flow is running.
 *
 * They are tested before any session or trigger, on the EXACT normalized
 * message: "PARAR!" and "parar" opt out, "quero parar" does not — a whole
 * sentence containing the word is a message, not a command, and folding it
 * into an opt-out would silently unsubscribe people mid-conversation.
 *
 * Opt-out is a Meta platform expectation as much as a courtesy: a contact
 * who asked to stop and keeps getting broadcasts is a report waiting to
 * happen.
 */

export const OPT_OUT_KEYWORDS = ["parar", "sair", "stop", "cancelar"] as const;
export const OPT_IN_KEYWORDS = ["voltar"] as const;

export const OPT_OUT_CONFIRMATION =
  "Pronto, você não receberá mais mensagens automáticas. Envie *voltar* para reativar.";
export const OPT_IN_CONFIRMATION =
  "Pronto, você voltou a receber mensagens automáticas.";

export type GlobalKeyword = "opt_out" | "opt_in";

/** Which global command this message is, if any. */
export function classifyGlobalKeyword(text: string): GlobalKeyword | null {
  const folded = normalizeText(text);
  if (!folded) return null;
  if ((OPT_OUT_KEYWORDS as readonly string[]).includes(folded)) return "opt_out";
  if ((OPT_IN_KEYWORDS as readonly string[]).includes(folded)) return "opt_in";
  return null;
}

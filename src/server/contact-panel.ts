import type { PrismaClient } from "@prisma/client";
import { coerceFieldValue } from "../lib/field-values";
import { fromFieldType } from "../lib/field-usage";
import { canSend } from "../lib/messaging-window";
import { saveContactField } from "./contact-fields";
import { recordContactEvent } from "./contact-events";
import { sendText } from "./instagram";

/**
 * What the contact page can do to one contact, beyond the tag/opt-out
 * helpers in contact-events.ts. Thin on purpose: each function is the one
 * rule the UI must not get wrong (a typed value is coerced before it is
 * stored, a session is only abandoned while it is open, a human message
 * only gets the HUMAN_AGENT tag when the deployment allows it).
 */

/**
 * Whether the panel may send under HUMAN_AGENT. Meta grants the tag per app
 * (the human_agent permission); a deployment without it sets HUMAN_AGENT=off
 * so the option never shows and a send outside 24h fails honestly instead of
 * being rejected by the API with a flag on the app.
 */
export function humanAgentAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HUMAN_AGENT ?? "on").toLowerCase() !== "off";
}

/** Store a value typed by the owner, in the canonical form of the field's declared type. */
export async function setContactFieldFromPanel(
  db: PrismaClient,
  contactId: string,
  key: string,
  raw: string,
): Promise<string> {
  const field = await db.customField.findUnique({ where: { key } });
  if (!field) throw new Error(`O campo "${key}" não está registrado.`);
  const type = fromFieldType(field.type);
  const value = coerceFieldValue(raw.trim(), type);
  await saveContactField(db, contactId, key, value, type);
  return value;
}

/** Remove a value. Recorded as FIELD_SET with an empty value, the same shape the runner's unsetField leaves. */
export async function unsetContactFieldFromPanel(
  db: PrismaClient,
  contactId: string,
  key: string,
): Promise<void> {
  const { count } = await db.contactField.deleteMany({ where: { contactId, key } });
  if (count === 0) return;
  await recordContactEvent(db, contactId, "FIELD_SET", { key, value: "" });
}

/** Abandon one open session. A finished session is left as it is. */
export async function abandonSession(db: PrismaClient, sessionId: string): Promise<boolean> {
  const { count } = await db.flowSession.updateMany({
    where: { id: sessionId, status: { in: ["ACTIVE", "WAITING_INPUT"] } },
    data: { status: "ABANDONED", abandonedAt: new Date() },
  });
  return count > 0;
}

/**
 * A message typed by the owner on the contact page.
 *
 * Inside the 24h window it is a plain send. Outside, the caller may ask for
 * HUMAN_AGENT; that is honoured only when the deployment allows it, and
 * `canSend` still has the last word (7 days, then nothing).
 */
export async function sendPanelMessage(
  db: PrismaClient,
  contactId: string,
  text: string,
  opts: { humanAgent?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<{ tag?: "HUMAN_AGENT" }> {
  const clean = text.trim();
  if (!clean) throw new Error("Escreva a mensagem antes de enviar.");
  if (clean.length > 1000) throw new Error("A mensagem passa de 1000 caracteres.");

  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { lastInboundAt: true, subscribed: true },
  });
  if (!contact) throw new Error("Contato não encontrado.");

  const useTag = Boolean(opts.humanAgent) && humanAgentAllowed(opts.env);
  const tag = useTag ? ("HUMAN_AGENT" as const) : undefined;

  const decision = canSend(contact.lastInboundAt, { tag });
  if (!decision.allowed) throw new Error(reasonPt(decision.reason));

  await sendText(db, contactId, clean, { tag });
  return { tag: decision.tag === "HUMAN_AGENT" ? "HUMAN_AGENT" : undefined };
}

/** canSend speaks English for the logs; the owner reads Portuguese. */
function reasonPt(reason: string): string {
  if (reason.startsWith("Contact has never"))
    return "Este contato nunca escreveu; o Instagram não permite iniciar a conversa.";
  if (reason.startsWith("Outside the 7-day")) return "Fora da janela de 7 dias do HUMAN_AGENT.";
  return "Fora da janela de 24 horas. Aguarde o contato escrever de novo ou use a tag HUMAN_AGENT.";
}

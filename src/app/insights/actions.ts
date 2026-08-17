"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../server/db";

/**
 * Actions for the "typed and didn't match" panel.
 *
 * The panel's only real job is to end in a trigger, so the primary action
 * creates one from a row and marks the row resolved in the same step — a
 * keyword you already handled must stop competing for attention with the
 * ones you haven't.
 */

/**
 * Turn an unmatched phrase into a KEYWORD trigger on an existing flow.
 *
 * The stored `normalized` text is used as the pattern, not the verbatim
 * sample: normalization is idempotent and matching folds both sides anyway,
 * so the accent-free form is the one that reads clearly in the trigger list.
 */
export async function createTriggerFromUnmatched(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const flowId = String(formData.get("flowId") ?? "");
  if (!id) throw new Error("Mensagem não informada.");
  if (!flowId) throw new Error("Escolha um fluxo para o gatilho.");

  const row = await db.unmatchedMessage.findUnique({ where: { id } });
  if (!row) throw new Error("Mensagem não encontrada.");

  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow) throw new Error("Fluxo não encontrado.");

  const pattern = row.normalized.slice(0, 200);

  // An identical keyword already pointing somewhere is a conflict the owner
  // should resolve deliberately, not something to silently duplicate.
  const clash = await db.trigger.findFirst({
    where: { kind: "KEYWORD", pattern },
  });
  if (clash) {
    throw new Error(`Já existe um gatilho com a palavra "${pattern}".`);
  }

  await db.trigger.create({
    data: { flowId, kind: "KEYWORD", pattern, match: "CONTAINS", enabled: true },
  });

  await db.unmatchedMessage.update({
    where: { id },
    data: { resolvedAt: new Date() },
  });

  revalidatePath("/insights");
  redirect(`/flows/${flowId}`);
}

/** Hide a row without creating anything — noise, typos, one-offs. */
export async function dismissUnmatched(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Mensagem não informada.");

  await db.unmatchedMessage.update({
    where: { id },
    data: { resolvedAt: new Date() },
  });

  revalidatePath("/insights");
}

/** Put a dismissed row back in the list. */
export async function restoreUnmatched(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Mensagem não informada.");

  await db.unmatchedMessage.update({ where: { id }, data: { resolvedAt: null } });

  revalidatePath("/insights");
}

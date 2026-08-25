"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";
import {
  addTagToContact,
  removeTagFromContact,
  setContactSubscribed,
} from "../../server/contact-events";
import { exportContactsCsv } from "../../server/contacts-csv";
import { startFlow } from "../../server/flow-runner";

const MAX_BULK = 500;

function cleanIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) throw new Error("Nenhum contato selecionado.");
  const clean = Array.from(new Set(ids.filter((i): i is string => typeof i === "string" && !!i)));
  if (clean.length === 0) throw new Error("Nenhum contato selecionado.");
  if (clean.length > MAX_BULK) throw new Error(`Selecione no máximo ${MAX_BULK} contatos por vez.`);
  return clean;
}

/**
 * Opt a contact out (or back in) from the panel. Same rule as the "parar"
 * keyword: unsubscribing abandons open sessions, and the change lands on the
 * contact's timeline.
 */
export async function setSubscribed(contactId: string, subscribed: boolean): Promise<void> {
  if (!contactId) throw new Error("Contato não informado.");
  await setContactSubscribed(db, contactId, subscribed, "panel");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${contactId}`);
}

/** Add or remove one tag on many contacts. Returns how many actually changed. */
export async function bulkTag(
  ids: string[],
  tagName: string,
  mode: "add" | "remove",
): Promise<number> {
  const contactIds = cleanIds(ids);
  const name = tagName.trim();
  if (!name) throw new Error("Escolha uma etiqueta.");

  let changed = 0;
  for (const id of contactIds) {
    const before = await db.contactTag.count({ where: { contactId: id, tag: { name } } });
    if (mode === "add") await addTagToContact(db, id, name, "panel");
    else await removeTagFromContact(db, id, name, "panel");
    const after = await db.contactTag.count({ where: { contactId: id, tag: { name } } });
    if (before !== after) changed++;
  }
  revalidatePath("/contacts");
  return changed;
}

export async function bulkSetSubscribed(ids: string[], subscribed: boolean): Promise<void> {
  for (const id of cleanIds(ids)) await setContactSubscribed(db, id, subscribed, "panel");
  revalidatePath("/contacts");
}

/**
 * Start a flow for many contacts. `startFlow` refuses opted-out contacts,
 * disabled flows and contacts already inside that flow; those count as
 * skipped rather than failing the whole batch.
 */
export async function bulkStartFlow(
  ids: string[],
  flowId: string,
): Promise<{ started: number; skipped: number }> {
  if (!flowId) throw new Error("Escolha um fluxo.");
  let started = 0;
  let skipped = 0;
  for (const id of cleanIds(ids)) {
    const result = await startFlow(db, flowId, id);
    if (result) started++;
    else skipped++;
  }
  revalidatePath("/contacts");
  return { started, skipped };
}

/** CSV of the selected contacts, for the client to download. */
export async function exportSelectionCsv(ids: string[]): Promise<string> {
  return exportContactsCsv(db, { where: { id: { in: cleanIds(ids) } } });
}

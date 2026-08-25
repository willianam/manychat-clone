"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../../server/db";
import { addTagToContact, removeTagFromContact } from "../../../server/contact-events";
import {
  abandonSession as abandonSessionRow,
  sendPanelMessage,
  setContactFieldFromPanel,
  unsetContactFieldFromPanel,
} from "../../../server/contact-panel";
import {
  addContactNote,
  contactTimeline,
  deleteContactNote,
} from "../../../server/contact-timeline";
import { toTimelineDto, type TimelineItemDto } from "../../../lib/ui/timeline";

function need(id: string, what: string): string {
  if (!id) throw new Error(`${what} não informado.`);
  return id;
}

function refresh(contactId: string) {
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
}

export async function addTag(contactId: string, tagName: string): Promise<void> {
  const name = tagName.trim();
  if (!name) throw new Error("Escolha uma etiqueta.");
  await addTagToContact(db, need(contactId, "Contato"), name, "panel");
  refresh(contactId);
}

export async function removeTag(contactId: string, tagName: string): Promise<void> {
  await removeTagFromContact(db, need(contactId, "Contato"), tagName, "panel");
  refresh(contactId);
}

/** Returns the stored (coerced) value so the input can show what was kept. */
export async function setField(contactId: string, key: string, value: string): Promise<string> {
  const stored = await setContactFieldFromPanel(db, need(contactId, "Contato"), key, value);
  refresh(contactId);
  return stored;
}

export async function unsetField(contactId: string, key: string): Promise<void> {
  await unsetContactFieldFromPanel(db, need(contactId, "Contato"), key);
  refresh(contactId);
}

export async function addNote(contactId: string, text: string): Promise<void> {
  await addContactNote(db, need(contactId, "Contato"), text);
  refresh(contactId);
}

export async function deleteNote(contactId: string, noteId: string): Promise<void> {
  await deleteContactNote(db, need(noteId, "Nota"));
  refresh(contactId);
}

export async function abandonSession(contactId: string, sessionId: string): Promise<void> {
  const done = await abandonSessionRow(db, need(sessionId, "Sessão"));
  if (!done) throw new Error("A sessão já tinha terminado.");
  refresh(contactId);
}

export async function sendMessage(
  contactId: string,
  text: string,
  humanAgent: boolean,
): Promise<{ tag?: "HUMAN_AGENT" }> {
  const result = await sendPanelMessage(db, need(contactId, "Contato"), text, { humanAgent });
  refresh(contactId);
  return result;
}

export async function loadTimeline(
  contactId: string,
  before: string | null,
): Promise<{ items: TimelineItemDto[]; nextBefore: string | null }> {
  const page = await contactTimeline(db, need(contactId, "Contato"), {
    limit: 50,
    before: before ? new Date(before) : undefined,
  });
  return {
    items: page.items.map(toTimelineDto),
    nextBefore: page.nextBefore ? page.nextBefore.toISOString() : null,
  };
}

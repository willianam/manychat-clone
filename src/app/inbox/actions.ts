"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";
import {
  createQuickReply,
  deleteQuickReply,
  markRead,
  reply,
  setAutomationPaused,
} from "../../server/inbox";
import { addContactNote } from "../../server/contact-timeline";

/**
 * Server actions behind the inbox. Each one revalidates /inbox so the next
 * router.refresh (the live poll) sees the change; errors carry a pt-BR
 * message and surface as toasts in the client.
 */

export async function replyAction(
  contactId: string,
  input: { text: string; humanAgent?: boolean },
): Promise<void> {
  if (!contactId) throw new Error("Contato não informado.");
  await reply(db, contactId, input);
  revalidatePath("/inbox");
}

export async function markReadAction(contactId: string): Promise<void> {
  if (!contactId) return;
  await markRead(db, contactId);
  revalidatePath("/inbox");
}

export async function setPausedAction(contactId: string, paused: boolean): Promise<void> {
  if (!contactId) throw new Error("Contato não informado.");
  await setAutomationPaused(db, contactId, paused);
  revalidatePath("/inbox");
}

export async function addNoteAction(contactId: string, text: string): Promise<void> {
  if (!contactId) throw new Error("Contato não informado.");
  await addContactNote(db, contactId, text);
  revalidatePath("/inbox");
}

export async function createQuickReplyAction(input: {
  title: string;
  text: string;
  shortcut?: string;
}): Promise<void> {
  await createQuickReply(db, input);
  revalidatePath("/inbox");
}

export async function deleteQuickReplyAction(id: string): Promise<void> {
  if (!id) return;
  await deleteQuickReply(db, id);
  revalidatePath("/inbox");
}

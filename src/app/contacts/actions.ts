"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";
import { setContactSubscribed } from "../../server/contact-events";

/**
 * Opt a contact out (or back in) from the panel. Same rule as the "parar"
 * keyword: unsubscribing abandons open sessions, and the change lands on the
 * contact's timeline.
 */
export async function setSubscribed(contactId: string, subscribed: boolean): Promise<void> {
  if (!contactId) throw new Error("Contato não informado.");
  await setContactSubscribed(db, contactId, subscribed, "panel");
  revalidatePath("/contacts");
}

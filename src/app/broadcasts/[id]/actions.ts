"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { failForm } from "../../../lib/ui/form-error";
import { db } from "../../../server/db";
import { retryFailed } from "../../../server/broadcast-worker";
import { cancelBroadcast, duplicateBroadcast } from "../../../server/broadcast-detail";

export async function retryFailedRecipients(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) failForm("/broadcasts", "Disparo não informado.");
  const n = await retryFailed(db, id);
  if (n === 0)
    failForm(`/broadcasts/${id}`, "Nenhuma falha reenviável: as restantes são da janela de 24h.");
  revalidatePath(`/broadcasts/${id}`);
  revalidatePath("/broadcasts");
}

export async function duplicateBroadcastAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) failForm("/broadcasts", "Disparo não informado.");
  const copy = await duplicateBroadcast(db, id);
  revalidatePath("/broadcasts");
  redirect(`/broadcasts?criado=${copy.id}`);
}

export async function cancelBroadcastAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) failForm("/broadcasts", "Disparo não informado.");
  const ok = await cancelBroadcast(db, id);
  if (!ok)
    failForm(
      `/broadcasts/${id}`,
      "Só um disparo na fila pode ser cancelado; este já começou ou acabou.",
    );
  revalidatePath(`/broadcasts/${id}`);
  revalidatePath("/broadcasts");
}

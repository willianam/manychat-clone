"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../server/db";
import { enqueueBroadcast } from "../../server/broadcast-worker";

/**
 * Broadcast composition.
 *
 * The window filter is applied at enqueue time rather than stored, because
 * "inside the window" is a fact about the current instant — see
 * enqueueBroadcast.
 */

function parseWindow(raw: FormDataEntryValue | null): "in" | "out" | undefined {
  const v = String(raw ?? "");
  return v === "in" || v === "out" ? v : undefined;
}

export async function createBroadcast(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || "Disparo sem nome";
  const text = String(formData.get("text") ?? "").trim();
  if (!text) throw new Error("A mensagem não pode ficar vazia.");

  const filterTagIds = formData.getAll("tagIds").map(String).filter(Boolean);

  const b = await db.broadcast.create({
    data: { name, text, filterTagIds, status: "DRAFT" },
  });

  revalidatePath("/broadcasts");
  redirect(`/broadcasts?criado=${b.id}`);
}

/**
 * Queue a draft for sending.
 *
 * Recipients are materialized now, using the same audience filter the
 * preview counted, so what the owner saw is what gets a row.
 */
export async function queueBroadcast(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Disparo não informado.");

  const count = await enqueueBroadcast(db, id, { window: parseWindow(formData.get("window")) });
  if (count === 0) {
    throw new Error(
      "Nenhum contato se encaixa nesse filtro agora. Ajuste as etiquetas ou espere alguém escrever.",
    );
  }

  revalidatePath("/broadcasts");
}

export async function deleteBroadcast(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Disparo não informado.");
  await db.broadcast.delete({ where: { id } });
  revalidatePath("/broadcasts");
}

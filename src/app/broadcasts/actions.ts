"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../server/db";
import { enqueueBroadcast } from "../../server/broadcast-worker";
import { parseBroadcastForm } from "../../lib/broadcast-form";

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

/**
 * A scheduled draft is queued like any other ("Enfileirar" materializes the
 * recipients); every drainer already skips a broadcast whose `scheduledAt`
 * is still in the future, so nothing else is needed for it to wait.
 */
export async function createBroadcast(formData: FormData) {
  const { name, text, content, flowId, tag, filterTagIds, segmentId, scheduledAt } =
    parseBroadcastForm(formData);

  const b = await db.broadcast.create({
    data: {
      name,
      text,
      content: content ?? undefined,
      flowId,
      tag,
      filterTagIds,
      segmentId,
      scheduledAt,
      status: "DRAFT",
    },
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

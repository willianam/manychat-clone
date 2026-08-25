"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../server/db";
import { createSegment, deleteSegment, updateSegment } from "../../server/segments";
import { broadcastsUsingSegment } from "../../server/segment-usage";

function done() {
  revalidatePath("/segmentos");
  revalidatePath("/contacts");
  revalidatePath("/broadcasts");
}

export async function createSegmentAction(name: string, rules: unknown): Promise<void> {
  await createSegment(db, name, rules);
  done();
  redirect("/segmentos");
}

export async function updateSegmentAction(id: string, name: string, rules: unknown): Promise<void> {
  if (!id) throw new Error("Segmento não informado.");
  if (!name.trim()) throw new Error("O segmento precisa de um nome.");
  await updateSegment(db, id, { name, rules });
  done();
  redirect("/segmentos");
}

/** Refused while a broadcast points at the segment; the list shows which. */
export async function deleteSegmentAction(id: string): Promise<void> {
  if (!id) throw new Error("Segmento não informado.");
  const used = await broadcastsUsingSegment(db, id);
  if (used.length > 0) {
    throw new Error(
      `Usado por ${used.length} disparo(s): ${used.map((b) => b.name).join(", ")}. Troque a audiência deles antes de apagar.`,
    );
  }
  await deleteSegment(db, id);
  done();
}

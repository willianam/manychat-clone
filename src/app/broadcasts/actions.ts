"use server";

import { revalidatePath } from "next/cache";
import { failForm } from "../../lib/ui/form-error";
import { redirect } from "next/navigation";
import { db } from "../../server/db";
import { enqueueBroadcast } from "../../server/broadcast-worker";
import { parseBroadcastForm } from "../../lib/broadcast-form";
import { sendBroadcastTest, type BroadcastTestDraft } from "../../server/broadcast-test";
import { actionFailure, type ActionFailure } from "../../lib/ui/action-result";

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
 * Save the composer's post. `intent=draft` stores it; `intent=send` also
 * enqueues it — a future `scheduledAt` makes every drainer wait, so
 * "agendar" and "enviar agora" are the same path with a different clock.
 */
export async function createBroadcast(formData: FormData) {
  const { name, text, content, flowId, tag, filterTagIds, segmentId, scheduledAt } =
    parseBroadcastForm(formData);
  const intent = String(formData.get("intent") ?? "draft");

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

  if (intent === "send") {
    const count = await enqueueBroadcast(db, b.id, { window: parseWindow(formData.get("window")) });
    if (count === 0) {
      // enqueueBroadcast marks an empty audience DONE; a draft is more useful.
      await db.broadcast.update({ where: { id: b.id }, data: { status: "DRAFT" } });
      failForm("/broadcasts", 
        "Nenhum contato se encaixa nesse filtro agora. O disparo ficou salvo como rascunho.",
      );
    }
    revalidatePath("/broadcasts");
    redirect(`/broadcasts/${b.id}`);
  }

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
  if (!id) failForm("/broadcasts", "Disparo não informado.");

  const count = await enqueueBroadcast(db, id, { window: parseWindow(formData.get("window")) });
  if (count === 0) {
    failForm("/broadcasts", 
      "Nenhum contato se encaixa nesse filtro agora. Ajuste as etiquetas ou espere alguém escrever.",
    );
  }

  revalidatePath("/broadcasts");
}

export async function deleteBroadcast(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) failForm("/broadcasts", "Disparo não informado.");
  await db.broadcast.delete({ where: { id } });
  revalidatePath("/broadcasts");
}

/**
 * Send the composed broadcast to one contact, as a test.
 *
 * Nothing about the real path changes: no Broadcast row, no recipients, no
 * enqueue — see server/broadcast-test.ts. Failure comes back as a value
 * because the caller is a client component, and Next replaces the message of
 * a thrown Server Action error in production.
 */
export async function testBroadcast(
  draft: BroadcastTestDraft,
  contactId: string,
): Promise<{ ok: true } | ActionFailure> {
  if (!contactId) return actionFailure("Escolha um contato para receber o teste.");
  try {
    await sendBroadcastTest(db, draft, contactId);
    return { ok: true };
  } catch (err) {
    return actionFailure(
      err instanceof Error && err.message ? err.message : "Não foi possível enviar o teste.",
    );
  }
}

/** Contacts whose @username contains `q`, for the broadcast test dialog. */
export async function searchBroadcastTestContacts(
  q: string,
): Promise<Array<{ id: string; username: string | null; name: string | null }>> {
  const needle = q.trim().replace(/^@/, "");
  if (!needle) return [];
  return db.contact.findMany({
    where: { username: { contains: needle, mode: "insensitive" } },
    select: { id: true, username: true, name: true },
    orderBy: { username: "asc" },
    take: 8,
  });
}

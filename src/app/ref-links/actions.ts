"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";
import { generateRefCode, validateRefCode } from "../../lib/entry-events";

/**
 * Ref link CRUD.
 *
 * The code is the routing key the webhook looks up, so it is validated and
 * normalized here — the one place a link is born. A code Meta refuses to
 * echo produces a link that silently opens a plain DM, with no error
 * anywhere, so it must never reach the database.
 */

export async function createRefLink(formData: FormData) {
  const label = String(formData.get("label") ?? "")
    .trim()
    .slice(0, 120);
  if (!label) throw new Error("Dê um nome ao link para reconhecê-lo depois.");

  const flowId = String(formData.get("flowId") ?? "");
  if (!flowId) throw new Error("Escolha o fluxo que o link deve disparar.");

  const flow = await db.flow.findUnique({ where: { id: flowId } });
  if (!flow) throw new Error("Fluxo não encontrado.");

  const raw = String(formData.get("code") ?? "").trim();
  const code = raw ? requireValidCode(raw) : await uniqueGeneratedCode();

  const clash = await db.refLink.findUnique({ where: { code } });
  if (clash) throw new Error(`Já existe um link com o código "${code}".`);

  await db.refLink.create({ data: { code, label, flowId } });

  revalidatePath("/ref-links");
}

export async function setRefLinkEnabled(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Link não informado.");
  const enabled = String(formData.get("enabled") ?? "") === "true";

  await db.refLink.update({ where: { id }, data: { enabled } });

  revalidatePath("/ref-links");
}

export async function deleteRefLink(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Link não informado.");

  await db.refLink.delete({ where: { id } });

  revalidatePath("/ref-links");
}

function requireValidCode(raw: string): string {
  const result = validateRefCode(raw);
  if (!result.ok) throw new Error(result.error);
  return result.code;
}

/**
 * A generated code that is free.
 *
 * 31^8 keeps collisions vanishingly rare, but "vanishingly" is not "never"
 * and a collision here would throw in the user's face for no reason.
 */
async function uniqueGeneratedCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRefCode();
    const taken = await db.refLink.findUnique({ where: { code } });
    if (!taken) return code;
  }
  throw new Error("Não foi possível gerar um código livre. Tente informar um manualmente.");
}

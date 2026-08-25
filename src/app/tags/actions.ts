"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";

/**
 * Tag CRUD.
 *
 * Tags are referenced from three places that Postgres cannot protect for us:
 * flow `action` nodes and `condition` nodes hold a tag NAME inside the graph
 * JSON, and Broadcast holds tag IDs in a String[]. So renaming or deleting a
 * tag can silently break a live flow. Every destructive path here therefore
 * looks for those references first — see `findUsage`.
 */

function cleanName(raw: FormDataEntryValue | null): string {
  return String(raw ?? "")
    .trim()
    .slice(0, 60);
}

/**
 * Where is this tag referenced, outside the ContactTag join table?
 *
 * Flow graphs are scanned as raw JSON text rather than parsed: a tag name can
 * sit in an action node's `tagName` or a condition node's `key`, and matching
 * the serialized value catches both without duplicating the schema's shape.
 */
async function findUsage(tagId: string, tagName: string) {
  const [flows, broadcasts] = await Promise.all([
    db.flow.findMany({ select: { id: true, name: true, graph: true } }),
    db.broadcast.findMany({
      where: { filterTagIds: { has: tagId } },
      select: { id: true, name: true },
    }),
  ]);

  const needle = JSON.stringify(tagName);
  const usedByFlows = flows
    .filter((f) => JSON.stringify(f.graph).includes(needle))
    .map((f) => ({ id: f.id, name: f.name }));

  return { flows: usedByFlows, broadcasts };
}

export async function createTag(formData: FormData) {
  const name = cleanName(formData.get("name"));
  if (!name) throw new Error("O nome da etiqueta não pode ficar vazio.");

  const color = String(formData.get("color") ?? "#6366f1");

  const existing = await db.tag.findUnique({ where: { name } });
  if (existing) throw new Error(`A etiqueta "${name}" já existe.`);

  await db.tag.create({ data: { name, color } });
  revalidatePath("/tags");
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Rename a tag and/or change its color.
 *
 * The tag id does not change, so contacts and broadcast filters follow
 * automatically. Flow graphs do NOT: they store the name. We rewrite the
 * name inside every graph that mentions it, in the same transaction, so a
 * rename can't leave an action node pointing at a tag that no longer exists.
 * A color-only change touches nothing but the Tag row.
 */
export async function renameTag(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = cleanName(formData.get("name"));
  if (!id) throw new Error("Etiqueta não informada.");
  if (!name) throw new Error("O nome da etiqueta não pode ficar vazio.");

  const tag = await db.tag.findUnique({ where: { id } });
  if (!tag) throw new Error("Etiqueta não encontrada.");

  const rawColor = String(formData.get("color") ?? "");
  const color = COLOR_RE.test(rawColor) ? rawColor.toLowerCase() : tag.color;
  if (tag.name === name) {
    if (color !== tag.color) {
      await db.tag.update({ where: { id }, data: { color } });
      revalidatePath("/tags");
      revalidatePath("/contacts");
    }
    return;
  }

  const clash = await db.tag.findUnique({ where: { name } });
  if (clash) {
    throw new Error(`Já existe uma etiqueta "${name}". Use "mesclar" para juntar as duas.`);
  }

  const usage = await findUsage(id, tag.name);

  await db.$transaction([
    db.tag.update({ where: { id }, data: { name, color } }),
    ...usage.flows.map(
      (f) =>
        db.$executeRaw`UPDATE "Flow" SET graph = REPLACE(graph::text, ${JSON.stringify(tag.name)}, ${JSON.stringify(name)})::jsonb WHERE id = ${f.id}`,
    ),
  ]);

  revalidatePath("/tags");
  revalidatePath("/flows");
  revalidatePath("/contacts");
}

/**
 * Delete a tag.
 *
 * Refuses while a flow or broadcast still references it, unless the caller
 * confirms. ContactTag rows cascade at the schema level; the graphs do not,
 * which is exactly why the warning exists.
 */
export async function deleteTag(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Etiqueta não informada.");
  const confirmed = String(formData.get("confirm") ?? "") === "true";

  const tag = await db.tag.findUnique({ where: { id } });
  if (!tag) throw new Error("Etiqueta não encontrada.");

  const usage = await findUsage(id, tag.name);
  const inUse = usage.flows.length > 0 || usage.broadcasts.length > 0;

  if (inUse && !confirmed) {
    const parts = [
      usage.flows.length
        ? `${usage.flows.length} fluxo(s): ${usage.flows.map((f) => f.name).join(", ")}`
        : "",
      usage.broadcasts.length ? `${usage.broadcasts.length} disparo(s)` : "",
    ].filter(Boolean);
    throw new Error(
      `"${tag.name}" está em uso por ${parts.join(" e ")}. Excluir vai quebrar essas referências — confirme para prosseguir.`,
    );
  }

  // Broadcast filters hold ids in a String[] with no FK, so they must be
  // cleaned by hand or they would filter on a tag that no longer exists.
  for (const b of usage.broadcasts) {
    const row = await db.broadcast.findUniqueOrThrow({ where: { id: b.id } });
    await db.broadcast.update({
      where: { id: b.id },
      data: { filterTagIds: row.filterTagIds.filter((t) => t !== id) },
    });
  }

  await db.tag.delete({ where: { id } });

  revalidatePath("/tags");
}

/**
 * Merge `sourceId` into `targetId`.
 *
 * Contacts on the source gain the target (skipping those who already have
 * it, since ContactTag is keyed on the pair), broadcast filters are rewritten
 * to the target id, flow graphs are rewritten to the target name, and the
 * source is removed. The intent is that nothing anywhere still points at the
 * tag that disappeared.
 */
export async function mergeTags(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  if (!sourceId || !targetId) throw new Error("Escolha as duas etiquetas.");
  if (sourceId === targetId) throw new Error("Escolha duas etiquetas diferentes.");

  const [source, target] = await Promise.all([
    db.tag.findUnique({ where: { id: sourceId } }),
    db.tag.findUnique({ where: { id: targetId } }),
  ]);
  if (!source || !target) throw new Error("Etiqueta não encontrada.");

  const links = await db.contactTag.findMany({
    where: { tagId: sourceId },
    select: { contactId: true },
  });

  const usage = await findUsage(sourceId, source.name);

  await db.$transaction([
    // skipDuplicates covers contacts who already carry the target tag.
    db.contactTag.createMany({
      data: links.map((l) => ({ contactId: l.contactId, tagId: targetId })),
      skipDuplicates: true,
    }),
    ...usage.flows.map(
      (f) =>
        db.$executeRaw`UPDATE "Flow" SET graph = REPLACE(graph::text, ${JSON.stringify(source.name)}, ${JSON.stringify(target.name)})::jsonb WHERE id = ${f.id}`,
    ),
    // Deleting the source cascades its ContactTag rows.
    db.tag.delete({ where: { id: sourceId } }),
  ]);

  for (const b of usage.broadcasts) {
    const row = await db.broadcast.findUniqueOrThrow({ where: { id: b.id } });
    const next = Array.from(new Set(row.filterTagIds.map((t) => (t === sourceId ? targetId : t))));
    await db.broadcast.update({ where: { id: b.id }, data: { filterTagIds: next } });
  }

  revalidatePath("/tags");
  revalidatePath("/flows");
}

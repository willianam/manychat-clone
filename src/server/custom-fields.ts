import type { CustomField, PrismaClient } from "@prisma/client";
import type { FieldValueType } from "../lib/field-values";
import { fieldKeysInGraph, toFieldType } from "../lib/field-usage";

/**
 * The custom field registry.
 *
 * A key can be written by any flow without being registered first, so the
 * registry is descriptive, not a constraint: it gives a key a label and a
 * type for the UI and the segment builder. `ensureCustomField` is what keeps
 * it complete — the runner calls it on every field write.
 */

const KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function listCustomFields(db: PrismaClient): Promise<CustomField[]> {
  return db.customField.findMany({ orderBy: { key: "asc" } });
}

export async function createCustomField(
  db: PrismaClient,
  input: { key: string; label?: string; type?: FieldValueType; defaultValue?: string | null },
): Promise<CustomField> {
  const key = input.key.trim();
  if (!KEY_RE.test(key)) {
    throw new Error("A chave precisa começar com letra ou _ e conter só letras, números e _.");
  }
  const existing = await db.customField.findUnique({ where: { key } });
  if (existing) throw new Error(`O campo "${key}" já existe.`);

  return db.customField.create({
    data: {
      key,
      label: input.label?.trim() || key,
      type: toFieldType(input.type ?? "text"),
      defaultValue: input.defaultValue || null,
    },
  });
}

/**
 * Rename changes the LABEL only. The key is what flows reference inside their
 * graphs and what ContactField rows are stored under; renaming it would need
 * a rewrite of both, and a label is what the owner actually wanted to fix.
 */
export async function renameCustomField(
  db: PrismaClient,
  id: string,
  label: string,
): Promise<CustomField> {
  const clean = label.trim();
  if (!clean) throw new Error("O nome do campo não pode ficar vazio.");
  return db.customField.update({ where: { id }, data: { label: clean } });
}

/** Flows whose graph writes this key. */
export async function flowsUsingField(
  db: PrismaClient,
  key: string,
): Promise<Array<{ id: string; name: string }>> {
  const flows = await db.flow.findMany({ select: { id: true, name: true, graph: true } });
  return flows
    .filter((f) => fieldKeysInGraph(f.graph).has(key))
    .map((f) => ({ id: f.id, name: f.name }));
}

/**
 * Delete a registry entry. Refused while a flow still writes the key: the
 * registry row is what makes that write visible, and silently orphaning it
 * is how a field "disappears" from the UI while still filling up.
 *
 * ContactField values are left alone — they are the contact's data.
 */
export async function deleteCustomField(db: PrismaClient, id: string): Promise<void> {
  const field = await db.customField.findUnique({ where: { id } });
  if (!field) throw new Error("Campo não encontrado.");

  const used = await flowsUsingField(db, field.key);
  if (used.length) {
    throw new Error(
      `"${field.key}" está em uso por ${used.length} fluxo(s): ${used.map((f) => f.name).join(", ")}. Remova o campo desses fluxos antes de excluir.`,
    );
  }

  await db.customField.delete({ where: { id } });
}

/**
 * Auto-registration. One idempotent upsert: an existing row is untouched, so
 * a type set on /campos is never overwritten by what a later value looks like.
 */
export async function ensureCustomField(
  db: PrismaClient,
  key: string,
  type: FieldValueType,
): Promise<void> {
  await db.customField.upsert({
    where: { key },
    create: { key, label: key, type: toFieldType(type) },
    update: {},
  });
}

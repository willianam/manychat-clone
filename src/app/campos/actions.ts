"use server";

import { revalidatePath } from "next/cache";
import { failForm } from "../../lib/ui/form-error";
import { db } from "../../server/db";
import {
  createCustomField,
  deleteCustomField,
  updateCustomField,
} from "../../server/custom-fields";
import type { FieldValueType } from "../../lib/field-values";

const TYPES: FieldValueType[] = ["text", "number", "date", "boolean"];

function readType(raw: FormDataEntryValue | null): FieldValueType {
  const t = String(raw ?? "text");
  return TYPES.includes(t as FieldValueType) ? (t as FieldValueType) : "text";
}

export async function createField(formData: FormData) {
  await createCustomField(db, {
    key: String(formData.get("key") ?? ""),
    label: String(formData.get("label") ?? ""),
    type: readType(formData.get("type")),
    defaultValue: String(formData.get("defaultValue") ?? "").trim() || null,
  });
  revalidatePath("/campos");
}

export async function updateField(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) failForm("/campos", "Campo não informado.");
  await updateCustomField(db, id, {
    label: String(formData.get("label") ?? ""),
    type: readType(formData.get("type")),
    defaultValue: String(formData.get("defaultValue") ?? "").trim() || null,
  });
  revalidatePath("/campos");
  revalidatePath("/contacts");
}

export async function deleteField(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) failForm("/campos", "Campo não informado.");
  await deleteCustomField(db, id);
  revalidatePath("/campos");
}

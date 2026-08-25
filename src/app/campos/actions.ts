"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";
import {
  createCustomField,
  renameCustomField,
  deleteCustomField,
} from "../../server/custom-fields";
import type { FieldValueType } from "../../lib/field-values";

const TYPES: FieldValueType[] = ["text", "number", "date", "boolean"];

export async function createField(formData: FormData) {
  const rawType = String(formData.get("type") ?? "text");
  await createCustomField(db, {
    key: String(formData.get("key") ?? ""),
    label: String(formData.get("label") ?? ""),
    type: TYPES.includes(rawType as FieldValueType) ? (rawType as FieldValueType) : "text",
    defaultValue: String(formData.get("defaultValue") ?? "").trim() || null,
  });
  revalidatePath("/campos");
}

export async function renameField(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Campo não informado.");
  await renameCustomField(db, id, String(formData.get("label") ?? ""));
  revalidatePath("/campos");
}

export async function deleteField(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Campo não informado.");
  await deleteCustomField(db, id);
  revalidatePath("/campos");
}

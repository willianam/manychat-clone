"use server";

import { revalidatePath } from "next/cache";
import { db } from "../../server/db";
import { importContactsCsv, type ImportReport } from "../../server/contacts-csv";

/** 2 MB of CSV is tens of thousands of rows; more than that is not a paste-and-go import. */
const MAX_BYTES = 2 * 1024 * 1024;

function check(csv: unknown): string {
  if (typeof csv !== "string" || !csv.trim()) throw new Error("O arquivo está vazio.");
  if (new TextEncoder().encode(csv).byteLength > MAX_BYTES) {
    throw new Error("O arquivo passa de 2 MB. Divida em partes menores.");
  }
  return csv;
}

/** Read-only pass: what would change if this file were applied. */
export async function previewImport(csv: string): Promise<ImportReport> {
  return importContactsCsv(db, check(csv), { dryRun: true });
}

export async function applyImport(csv: string): Promise<ImportReport> {
  const report = await importContactsCsv(db, check(csv));
  revalidatePath("/contacts");
  return report;
}

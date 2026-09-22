"use server";

import { revalidatePath } from "next/cache";
import { actionFailure, isActionFailure, type ActionFailure } from "../../lib/ui/action-result";
import { db } from "../../server/db";
import { importContactsCsv, type ImportReport } from "../../server/contacts-csv";

/** 2 MB of CSV is tens of thousands of rows; more than that is not a paste-and-go import. */
const MAX_BYTES = 2 * 1024 * 1024;

function check(csv: unknown): string | ActionFailure {
  if (typeof csv !== "string" || !csv.trim()) return actionFailure("O arquivo está vazio.");
  if (new TextEncoder().encode(csv).byteLength > MAX_BYTES) {
    return actionFailure("O arquivo passa de 2 MB. Divida em partes menores.");
  }
  return csv;
}

/** Read-only pass: what would change if this file were applied. */
export async function previewImport(csv: string): Promise<ImportReport | ActionFailure> {
  const text = check(csv);
  if (isActionFailure(text)) return text;
  return importContactsCsv(db, text, { dryRun: true });
}

export async function applyImport(csv: string): Promise<ImportReport | ActionFailure> {
  const text = check(csv);
  if (isActionFailure(text)) return text;
  const report = await importContactsCsv(db, text);
  revalidatePath("/contacts");
  return report;
}

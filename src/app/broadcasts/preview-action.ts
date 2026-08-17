"use server";

import { db } from "../../server/db";
import { previewAudience, type WindowPreview } from "../../server/broadcast-worker";

/**
 * Recount the audience for the compose screen.
 *
 * Split out from actions.ts because this one is read-only and called on every
 * filter change, while the rest of that file mutates and revalidates.
 */
export async function countAudience(tagIds: string[]): Promise<WindowPreview> {
  return previewAudience(db, { tagIds });
}

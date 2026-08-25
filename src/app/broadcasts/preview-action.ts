"use server";

import { db } from "../../server/db";
import { previewAudience, type WindowPreview } from "../../server/broadcast-worker";
import { parseSegmentRules } from "../../server/segments";

/**
 * Recount the audience for the compose screen.
 *
 * Split out from actions.ts because this one is read-only and called on every
 * filter change, while the rest of that file mutates and revalidates.
 *
 * A segment replaces the tag filter, exactly as `audienceOf` does for a
 * saved broadcast, so the number shown while composing is the number that
 * gets enqueued.
 */
export async function countAudience(
  filter: string[] | { tagIds?: string[]; segmentId?: string | null },
): Promise<WindowPreview> {
  const f = Array.isArray(filter) ? { tagIds: filter } : filter;
  if (f.segmentId) {
    const segment = await db.segment.findUnique({ where: { id: f.segmentId } });
    if (segment) return previewAudience(db, { rules: parseSegmentRules(segment.rules) });
  }
  return previewAudience(db, { tagIds: f.tagIds ?? [] });
}

"use server";

import { db } from "../../server/db";
import { countSegment, parseSegmentRules } from "../../server/segments";

/**
 * Live count for the builder. Read-only and called on every edit, so it
 * lives apart from the mutating actions. Invalid rules count as zero rather
 * than throwing: the builder shows its own validation.
 */
export async function countSegmentAction(rules: unknown): Promise<number | null> {
  let parsed;
  try {
    parsed = parseSegmentRules(rules);
  } catch {
    return null;
  }
  return countSegment(db, parsed);
}

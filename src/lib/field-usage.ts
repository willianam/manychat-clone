import type { FieldType } from "@prisma/client";
import { parseDate, parseNumber, type FieldValueType } from "./field-values";

/**
 * Where a flow graph writes contact fields, and what type a value looks like.
 *
 * Pure so the registry service and the tests share one definition of "this
 * key is in use". The graph is walked as loose JSON rather than through the
 * zod schema: an old graph that no longer validates still references keys,
 * and refusing to delete a field it uses is the safer answer.
 */

type LooseNode = {
  data?: { kind?: string; saveAs?: string; ops?: Array<Record<string, unknown>> };
};

/** Every field key a graph writes: question/quickreply `saveAs`, action `setField`/`unsetField`. */
export function fieldKeysInGraph(graph: unknown): Set<string> {
  const keys = new Set<string>();
  const nodes = (graph as { nodes?: LooseNode[] } | null)?.nodes;
  if (!Array.isArray(nodes)) return keys;

  for (const n of nodes) {
    const d = n?.data;
    if (!d) continue;
    if (typeof d.saveAs === "string" && d.saveAs) keys.add(d.saveAs);
    if (Array.isArray(d.ops)) {
      for (const op of d.ops) {
        if ((op.op === "setField" || op.op === "unsetField") && typeof op.key === "string") {
          keys.add(op.key);
        }
      }
    }
  }
  return keys;
}

/**
 * Best guess at a type from one value, for auto-registering a key the first
 * time a flow saves it. Booleans are only the literal words: a question
 * answered "sim" is text, not a boolean.
 */
export function inferFieldType(value: string): FieldValueType {
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "false") return "boolean";
  if (parseNumber(value) !== null) return "number";
  if (parseDate(value) !== null) return "date";
  return "text";
}

/** Prisma enum ⇄ the lowercase type used by lib/field-values and flow-schema. */
export function toFieldType(t: FieldValueType): FieldType {
  return t.toUpperCase() as FieldType;
}

export function fromFieldType(t: FieldType): FieldValueType {
  return t.toLowerCase() as FieldValueType;
}

/**
 * Renaming a tag inside a flow graph, by field rather than by text.
 *
 * Renaming used to be a raw `REPLACE(graph::text, ...)` over the whole
 * serialized graph. That rewrites ANY occurrence of the string: a tag called
 * "oi" renamed to "ola" also rewrote the message text "oi" in every node of
 * every flow that used it. The damage was silent and unrecoverable.
 *
 * A tag name reaches a graph in exactly three places:
 *   - a `tag` node's `tagName`
 *   - an action node's `addTag` / `removeTag` op `tagName`
 *   - a condition's `key`, when its `op` is `hasTag` or `notHasTag`
 *     (both on the single rule and on each entry of `rules`)
 *
 * Nothing else in a graph is a tag reference, so nothing else is touched.
 */

const TAG_OPS = new Set(["hasTag", "notHasTag"]);

type Json = unknown;

function isObj(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Rewrites every tag reference equal to `from` into `to`.
 * Returns the new graph and how many references changed.
 */
export function renameTagInGraph(
  graph: Json,
  from: string,
  to: string,
): { graph: Json; changed: number } {
  let changed = 0;

  const walk = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isObj(node)) return node;

    const next: Record<string, Json> = {};
    for (const [k, v] of Object.entries(node)) next[k] = walk(v);

    // A tag node, or an addTag/removeTag op.
    if (typeof next.tagName === "string" && next.tagName === from) {
      next.tagName = to;
      changed++;
    }

    // A condition rule whose key is a tag name.
    if (typeof next.op === "string" && TAG_OPS.has(next.op) && next.key === from) {
      next.key = to;
      changed++;
    }

    return next;
  };

  return { graph: walk(graph), changed };
}

/** Whether this graph references the tag at all - same rules as the rename. */
export function graphUsesTag(graph: Json, name: string): boolean {
  return renameTagInGraph(graph, name, `${name} `).changed > 0;
}

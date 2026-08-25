import { z } from "zod";
import { FlowEdge, FlowNode, type FlowGraph } from "./flow-schema";
import { reindexGraph } from "./flow-edit";

/**
 * Copy / paste of nodes, within a flow and across flows.
 *
 * The payload rides on the system clipboard as text with a fixed prefix, so
 * a paste in another tab (another flow) works and a paste of unrelated text
 * is ignored rather than mis-parsed. Ids are re-issued on paste — node ids
 * and button/option ids alike, since the latter double as edge handles and
 * two nodes claiming the same handle would make an edge ambiguous.
 */

export const CLIPBOARD_PREFIX = "manychat-clone/nodes:";

const Clip = z.object({ nodes: z.array(FlowNode).min(1), edges: z.array(FlowEdge) });
export type Clip = z.infer<typeof Clip>;

/** The selected nodes plus the edges running BETWEEN them; edges to the rest are dropped. */
export function clipSelection(graph: FlowGraph, ids: string[]): Clip | null {
  const wanted = new Set(ids);
  const nodes = graph.nodes.filter((n) => wanted.has(n.id));
  if (nodes.length === 0) return null;
  const edges = graph.edges.filter((e) => wanted.has(e.source) && wanted.has(e.target));
  return { nodes, edges };
}

export function serializeClip(clip: Clip): string {
  return CLIPBOARD_PREFIX + JSON.stringify(clip);
}

export function parseClip(text: string): Clip | null {
  if (!text.startsWith(CLIPBOARD_PREFIX)) return null;
  try {
    const parsed = Clip.safeParse(JSON.parse(text.slice(CLIPBOARD_PREFIX.length)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Add the clip to a graph with fresh ids, offset so the paste does not sit
 * exactly on top of the original. Returns the new node ids so the editor
 * can select them.
 */
export function pasteClip(
  graph: FlowGraph,
  clip: Clip,
  offset = { x: 40, y: 40 },
): { graph: FlowGraph; added: string[] } {
  const fresh = reindexGraph(clip);
  const nodes = fresh.nodes.map((n) => ({
    ...n,
    position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
  }));
  return {
    graph: { nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...fresh.edges] },
    added: nodes.map((n) => n.id),
  };
}

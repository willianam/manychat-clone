import dagre from "@dagrejs/dagre";
import { outputsOf, type FlowGraph } from "./flow-schema";

/**
 * Auto-layout ("Organizar"): a top-down tree via dagre.
 *
 * Handle order matters. A condition's "sim" leaves on the left and "não" on
 * the right, a quick reply's options top to bottom — the canvas is read in
 * that order, so the layout should keep it. Dagre honours insertion order as
 * the initial ordering of each rank, so edges are fed sorted by the index of
 * their handle in `outputsOf`; the crossing-reduction pass only departs from
 * it when that removes a crossing.
 *
 * Sizes are estimates per kind (the canvas nodes have fixed widths, heights
 * vary with content); a little too much room beats overlap.
 */

const SIZE: Record<string, { w: number; h: number }> = {
  message: { w: 248, h: 190 },
  question: { w: 248, h: 190 },
  quickreply: { w: 248, h: 220 },
  carousel: { w: 248, h: 200 },
  image: { w: 248, h: 190 },
  album: { w: 248, h: 150 },
  video: { w: 248, h: 120 },
  audio: { w: 248, h: 120 },
  file: { w: 248, h: 120 },
  request: { w: 248, h: 130 },
  end: { w: 140, h: 50 },
};
const DEFAULT_SIZE = { w: 224, h: 110 };

export function layoutGraph(graph: FlowGraph): FlowGraph {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of graph.nodes) {
    const size = SIZE[n.type] ?? DEFAULT_SIZE;
    g.setNode(n.id, { width: size.w, height: size.h });
  }

  const handleIndex = new Map<string, number>();
  for (const n of graph.nodes) {
    outputsOf(n).forEach((o, i) => handleIndex.set(`${n.id}:${o.handle}`, i));
  }
  const rank = (e: FlowGraph["edges"][number]) =>
    handleIndex.get(`${e.source}:${e.sourceHandle ?? ""}`) ?? Number.MAX_SAFE_INTEGER;

  const ordered = [...graph.edges].sort((a, b) => {
    if (a.source !== b.source) return 0;
    return rank(a) - rank(b);
  });
  for (const e of ordered) {
    // A self-loop or a duplicate pair adds nothing to the layout.
    if (e.source === e.target || g.hasEdge(e.source, e.target)) continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const { x, y } = g.node(n.id);
      const size = SIZE[n.type] ?? DEFAULT_SIZE;
      // dagre reports centres; React Flow positions the top-left corner.
      return {
        ...n,
        position: { x: Math.round(x - size.w / 2), y: Math.round(y - size.h / 2) },
      };
    }),
  };
}

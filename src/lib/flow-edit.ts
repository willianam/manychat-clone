import {
  LIMITS,
  outputsOf,
  type FlowButton,
  type FlowGraph,
  type FlowNodeData,
} from "./flow-schema";

/**
 * Editing primitives shared by the canvas and the properties panel.
 *
 * These live outside React on purpose. Two rules in here are load-bearing
 * enough that they must be testable without mounting a component:
 *
 *  1. **Option and button ids are edge handles.** Renaming a button's title
 *     must never regenerate its id, or the edge leaving it silently detaches
 *     and a live conversation dead-ends. Every editor here mutates titles in
 *     place and leaves `id` alone.
 *
 *  2. **Removing an output removes its edges.** Delete a quick-reply option
 *     and the edge that left it becomes an orphan pointing at a handle that
 *     no longer exists — `validateGraph` would not catch it, but the runner
 *     would strand on it. `pruneOrphanEdges` is the single place that reaps
 *     them, and it runs after every structural change.
 */

/** Short unique id, matching the prefix convention used by the editor. */
export const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Drop edges whose source/target node is gone, and edges leaving a named
 * handle the source node no longer exposes.
 *
 * Nodes whose outputs are anonymous (a single bottom handle) report a
 * `""` handle from `outputsOf`; their edges carry a null/undefined
 * sourceHandle and are always kept.
 */
export function pruneOrphanEdges(graph: FlowGraph): FlowGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  const edges = graph.edges.filter((e) => {
    const source = byId.get(e.source);
    if (!source || !byId.has(e.target)) return false;

    // No named handle on the edge: it uses the node's default output.
    if (e.sourceHandle === null || e.sourceHandle === undefined || e.sourceHandle === "") {
      return true;
    }

    const handles = new Set(outputsOf(source).map((o) => o.handle));
    return handles.has(e.sourceHandle);
  });

  return { nodes: graph.nodes, edges };
}

/** Remove a node and every edge touching it. */
export function removeNode(graph: FlowGraph, nodeId: string): FlowGraph {
  return {
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  };
}

/**
 * The primary text a node shows on the canvas, or null when the node has no
 * single editable string (carousel, condition, action…). Inline editing is
 * offered exactly for the kinds that return non-null here.
 */
export function inlineTextOf(data: FlowNodeData): string | null {
  switch (data.kind) {
    case "message":
    case "question":
    case "quickreply":
      return data.text;
    case "image":
      return data.caption ?? "";
    case "tag":
      return data.tagName;
    default:
      return null;
  }
}

/** Write back what `inlineTextOf` reads. Unknown kinds pass through. */
export function withInlineText(data: FlowNodeData, text: string): FlowNodeData {
  switch (data.kind) {
    case "message":
    case "question":
    case "quickreply":
      return { ...data, text };
    case "image":
      return { ...data, caption: text === "" ? undefined : text };
    case "tag":
      return { ...data, tagName: text };
    default:
      return data;
  }
}

/**
 * How many characters the inline editor allows for a node, so the UI can cap
 * typing rather than let the user write 900 characters and discover at save
 * time that a button template only holds 640.
 */
export function inlineLimitOf(data: FlowNodeData): number {
  if (data.kind === "message" && (data.buttons?.length ?? 0) > 0) {
    return LIMITS.buttonTemplateText;
  }
  if (data.kind === "tag") return 60;
  return LIMITS.messageText;
}

/** A fresh postback button. Ids are generated once, here, and never reissued. */
export function newButton(title = "Botão"): FlowButton {
  return { type: "postback", id: uid("b"), title: title.slice(0, 20) };
}

/**
 * Convert a button between postback and url while keeping its id — so an
 * existing edge survives a type change to url and back. Note that a url
 * button exposes no handle, so `pruneOrphanEdges` will reap its edge on the
 * way out; that is intended, since a url button cannot route in-flow.
 */
export function retypeButton(button: FlowButton, type: FlowButton["type"]): FlowButton {
  if (button.type === type) return button;
  if (type === "url") {
    return { type: "url", id: button.id, title: button.title, url: "https://exemplo.com" };
  }
  return { type: "postback", id: button.id, title: button.title };
}

/** The graph a brand-new flow starts from: a greeting wired to an end. */
export function starterGraph(): FlowGraph {
  const messageId = uid("message");
  const endId = uid("end");
  return {
    nodes: [
      {
        id: messageId,
        type: "message",
        position: { x: 240, y: 80 },
        data: { kind: "message", text: "Olá! Obrigado por chamar a gente por aqui." },
      },
      {
        id: endId,
        type: "end",
        position: { x: 300, y: 280 },
        data: { kind: "end" },
      },
    ],
    edges: [{ id: uid("e"), source: messageId, target: endId }],
  };
}

/**
 * Re-key every node, button, option and card id in a graph, rewriting edges
 * to match. Used when duplicating a flow so the copy shares no ids with the
 * original — ids are only unique within a graph, but keeping them identical
 * across two flows makes metrics and debugging ambiguous.
 */
export function reindexGraph(graph: FlowGraph): FlowGraph {
  const nodeMap = new Map<string, string>();
  const handleMap = new Map<string, string>();

  const remapButtons = (buttons: FlowButton[] | undefined): FlowButton[] | undefined =>
    buttons?.map((b) => {
      const next = uid("b");
      handleMap.set(b.id, next);
      return { ...b, id: next };
    });

  const nodes = graph.nodes.map((n) => {
    const nextId = uid(n.type);
    nodeMap.set(n.id, nextId);

    let data = n.data;
    if (data.kind === "quickreply") {
      data = {
        ...data,
        options: data.options.map((o) => {
          const next = uid("o");
          handleMap.set(o.id, next);
          return { ...o, id: next };
        }),
      };
    } else if (data.kind === "message") {
      data = { ...data, buttons: remapButtons(data.buttons) };
    } else if (data.kind === "carousel") {
      data = {
        ...data,
        cards: data.cards.map((c) => ({ ...c, id: uid("c"), buttons: remapButtons(c.buttons) })),
      };
    }

    return { ...n, id: nextId, data };
  });

  const edges = graph.edges.map((e) => ({
    ...e,
    id: uid("e"),
    source: nodeMap.get(e.source) ?? e.source,
    target: nodeMap.get(e.target) ?? e.target,
    sourceHandle: e.sourceHandle ? handleMap.get(e.sourceHandle) ?? e.sourceHandle : e.sourceHandle,
  }));

  return { nodes, edges };
}

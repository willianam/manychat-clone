import { z } from "zod";

/**
 * The flow document. This is exactly what React Flow persists, so the
 * editor and the runner share one source of truth — no translation layer
 * that can drift.
 *
 * Node kinds:
 *   message   — send text, continue
 *   question  — send text, wait for a reply, store it in context[saveAs]
 *   condition — branch on a context value; edges carry sourceHandle
 *               "true" / "false"
 *   delay     — pause; the worker resumes the session at resumeAt
 *   tag       — add or remove a tag, continue
 *   end       — terminate the session
 */

export const NodeKind = z.enum([
  "message",
  "question",
  "condition",
  "delay",
  "tag",
  "end",
]);
export type NodeKind = z.infer<typeof NodeKind>;

const MessageData = z.object({
  kind: z.literal("message"),
  text: z.string().min(1).max(1000),
});

const QuestionData = z.object({
  kind: z.literal("question"),
  text: z.string().min(1).max(1000),
  /** Context key the reply is written to. */
  saveAs: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
});

export const ConditionOp = z.enum([
  "equals",
  "contains",
  "exists",
  "gt",
  "lt",
  "hasTag",
]);

const ConditionData = z.object({
  kind: z.literal("condition"),
  /** Context key, or tag name when op is hasTag. */
  key: z.string().min(1),
  op: ConditionOp,
  value: z.string().optional(),
});

const DelayData = z.object({
  kind: z.literal("delay"),
  seconds: z.number().int().min(1).max(60 * 60 * 24 * 7),
});

const TagData = z.object({
  kind: z.literal("tag"),
  action: z.enum(["add", "remove"]),
  tagName: z.string().min(1),
});

const EndData = z.object({ kind: z.literal("end") });

export const FlowNodeData = z.discriminatedUnion("kind", [
  MessageData,
  QuestionData,
  ConditionData,
  DelayData,
  TagData,
  EndData,
]);
export type FlowNodeData = z.infer<typeof FlowNodeData>;

export const FlowNode = z.object({
  id: z.string().min(1),
  type: NodeKind,
  position: z.object({ x: z.number(), y: z.number() }),
  data: FlowNodeData,
});

export const FlowEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  /** "true" | "false" for condition nodes; absent otherwise. */
  sourceHandle: z.string().nullish(),
});

export const FlowGraph = z.object({
  nodes: z.array(FlowNode).min(1),
  edges: z.array(FlowEdge),
});
export type FlowGraph = z.infer<typeof FlowGraph>;

export type FlowIssue = { level: "error" | "warning"; message: string };

/**
 * Structural validation beyond shape. The editor calls this before save so
 * a broken graph never reaches the runner, where a dangling edge would
 * strand a live conversation.
 */
export function validateGraph(graph: FlowGraph): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));

  if (ids.size !== graph.nodes.length) {
    issues.push({ level: "error", message: "Duplicate node ids." });
  }

  for (const e of graph.edges) {
    if (!ids.has(e.source)) {
      issues.push({ level: "error", message: `Edge ${e.id} has unknown source ${e.source}.` });
    }
    if (!ids.has(e.target)) {
      issues.push({ level: "error", message: `Edge ${e.id} has unknown target ${e.target}.` });
    }
  }

  const targets = new Set(graph.edges.map((e) => e.target));
  const roots = graph.nodes.filter((n) => !targets.has(n.id));
  if (roots.length === 0) {
    issues.push({ level: "error", message: "No entry node — every node is a target, so the graph is a closed cycle." });
  }
  if (roots.length > 1) {
    issues.push({
      level: "warning",
      message: `${roots.length} entry nodes; the runner starts at "${roots[0]?.id}".`,
    });
  }

  for (const n of graph.nodes) {
    const out = graph.edges.filter((e) => e.source === n.id);
    if (n.data.kind === "condition") {
      const handles = new Set(out.map((e) => e.sourceHandle));
      if (!handles.has("true") || !handles.has("false")) {
        issues.push({
          level: "error",
          message: `Condition "${n.id}" needs both a true and a false branch.`,
        });
      }
    } else if (n.data.kind !== "end" && out.length === 0) {
      issues.push({
        level: "warning",
        message: `Node "${n.id}" is a dead end; the session will stop there.`,
      });
    }
  }

  return issues;
}

/** The node the runner starts from: first node with no inbound edge. */
export function findEntryNode(graph: FlowGraph): string | null {
  const targets = new Set(graph.edges.map((e) => e.target));
  return graph.nodes.find((n) => !targets.has(n.id))?.id ?? null;
}

"use client";

import { useCallback, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { FlowGraph, validateGraph, type FlowIssue } from "../lib/flow-schema";

/**
 * Drag-and-drop flow editor.
 *
 * The canvas document IS the persisted format (see lib/flow-schema.ts), so
 * what you arrange here is what the runner walks — no export step that can
 * silently diverge from the editor.
 */

const NODE_STYLE =
  "rounded-lg border-2 bg-white px-3 py-2 text-sm shadow-sm min-w-[160px] dark:bg-neutral-900";

function MessageNode({ data }: { data: { text?: string } }) {
  return (
    <div className={`${NODE_STYLE} border-indigo-400`}>
      <Handle type="target" position={Position.Top} />
      <div className="font-semibold text-indigo-600">Mensagem</div>
      <div className="mt-1 line-clamp-2 text-neutral-600 dark:text-neutral-300">
        {data.text || "(vazio)"}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function QuestionNode({ data }: { data: { text?: string; saveAs?: string } }) {
  return (
    <div className={`${NODE_STYLE} border-amber-400`}>
      <Handle type="target" position={Position.Top} />
      <div className="font-semibold text-amber-600">Pergunta</div>
      <div className="mt-1 line-clamp-2 text-neutral-600 dark:text-neutral-300">
        {data.text || "(vazio)"}
      </div>
      <div className="mt-1 font-mono text-xs text-neutral-400">→ {data.saveAs}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ConditionNode({ data }: { data: { key?: string; op?: string; value?: string } }) {
  return (
    <div className={`${NODE_STYLE} border-violet-400`}>
      <Handle type="target" position={Position.Top} />
      <div className="font-semibold text-violet-600">Condição</div>
      <div className="mt-1 font-mono text-xs text-neutral-600 dark:text-neutral-300">
        {data.key} {data.op} {data.value ?? ""}
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="text-emerald-600">sim</span>
        <span className="text-rose-600">não</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: "25%" }} />
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: "75%" }} />
    </div>
  );
}

function DelayNode({ data }: { data: { seconds?: number } }) {
  return (
    <div className={`${NODE_STYLE} border-sky-400`}>
      <Handle type="target" position={Position.Top} />
      <div className="font-semibold text-sky-600">Espera</div>
      <div className="mt-1 text-neutral-600 dark:text-neutral-300">{data.seconds}s</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function TagNode({ data }: { data: { action?: string; tagName?: string } }) {
  return (
    <div className={`${NODE_STYLE} border-teal-400`}>
      <Handle type="target" position={Position.Top} />
      <div className="font-semibold text-teal-600">Tag</div>
      <div className="mt-1 text-neutral-600 dark:text-neutral-300">
        {data.action === "add" ? "+" : "−"} {data.tagName}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function EndNode() {
  return (
    <div className={`${NODE_STYLE} border-neutral-400`}>
      <Handle type="target" position={Position.Top} />
      <div className="font-semibold text-neutral-600">Fim</div>
    </div>
  );
}

const nodeTypes = {
  message: MessageNode,
  question: QuestionNode,
  condition: ConditionNode,
  delay: DelayNode,
  tag: TagNode,
  end: EndNode,
};

const DEFAULTS: Record<string, object> = {
  message: { kind: "message", text: "Olá!" },
  question: { kind: "question", text: "Qual seu nome?", saveAs: "nome" },
  condition: { kind: "condition", key: "nome", op: "exists" },
  delay: { kind: "delay", seconds: 60 },
  tag: { kind: "tag", action: "add", tagName: "lead" },
  end: { kind: "end" },
};

export function FlowEditor({
  flowId,
  initial,
  onSave,
}: {
  flowId: string;
  initial: FlowGraph;
  onSave: (graph: FlowGraph) => Promise<void>;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges as Edge[]);
  const [saving, setSaving] = useState(false);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (kind: keyof typeof DEFAULTS) => {
      const id = `${kind}-${Date.now().toString(36)}`;
      setNodes((ns) => [
        ...ns,
        {
          id,
          type: kind,
          position: { x: 120 + Math.random() * 240, y: 80 + ns.length * 90 },
          data: DEFAULTS[kind],
        } as Node,
      ]);
    },
    [setNodes],
  );

  // Live validation: the Save button reflects whether the graph can run.
  const issues: FlowIssue[] = useMemo(() => {
    const parsed = FlowGraph.safeParse({ nodes, edges });
    if (!parsed.success) {
      return [{ level: "error", message: "Algum nó está com campos inválidos." }];
    }
    return validateGraph(parsed.data);
  }, [nodes, edges]);

  const errors = issues.filter((i) => i.level === "error");

  const save = async () => {
    if (errors.length) return;
    setSaving(true);
    try {
      await onSave(FlowGraph.parse({ nodes, edges }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {(Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>).map((k) => (
          <button
            key={k}
            onClick={() => addNode(k)}
            className="rounded border px-3 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            + {k}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          {errors.length > 0 && (
            <span className="text-sm text-rose-600">
              {errors.length} erro{errors.length > 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || errors.length > 0}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>

      {issues.length > 0 && (
        <ul className="border-b bg-amber-50 px-4 py-2 text-xs dark:bg-amber-950/30">
          {issues.map((i, n) => (
            <li key={n} className={i.level === "error" ? "text-rose-700" : "text-amber-700"}>
              {i.level === "error" ? "✗" : "⚠"} {i.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
    </div>
  );
}

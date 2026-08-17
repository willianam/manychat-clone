"use client";

import { useCallback, useMemo, useState } from "react";
import ReactFlow, {
  Background, Controls, MiniMap, addEdge,
  useNodesState, useEdgesState,
  type Connection, type Edge, type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { FlowGraph, validateGraph, type FlowIssue } from "../lib/flow-schema";
import type { FlowStats } from "../server/flow-metrics";
import { nodeTypes } from "./nodes";

/**
 * Flow editor.
 *
 * The canvas renders each node as the message it produces, with delivery
 * numbers in place. Adding a step goes through a side panel rather than a
 * toolbar of bare type names, so the choice is made by what the block does.
 */

const BLOCKS: Array<{
  kind: keyof typeof DEFAULTS;
  label: string;
  hint: string;
  tone: string;
}> = [
  { kind: "message",    label: "Texto",          hint: "Mensagem simples, com ou sem botões", tone: "text-indigo-600" },
  { kind: "quickreply", label: "Resposta rápida", hint: "Opções tocáveis que somem depois",   tone: "text-amber-600" },
  { kind: "carousel",   label: "Carrossel",       hint: "Cards lado a lado com botões",       tone: "text-violet-600" },
  { kind: "image",      label: "Imagem",          hint: "Manda uma imagem",                   tone: "text-sky-600" },
  { kind: "question",   label: "Coleta de dados", hint: "Espera uma resposta escrita",        tone: "text-amber-600" },
  { kind: "delay",      label: "Atraso",          hint: "Espera, respeitando horário",        tone: "text-rose-600" },
  { kind: "condition",  label: "Condição",        hint: "Divide o caminho em sim / não",      tone: "text-teal-600" },
  { kind: "action",     label: "Ações",           hint: "Marca tags e grava campos",          tone: "text-yellow-600" },
  { kind: "random",     label: "Randomizador",    hint: "Divide o tráfego para testar",       tone: "text-slate-600" },
  { kind: "end",        label: "Fim",             hint: "Encerra a conversa",                 tone: "text-neutral-600" },
];

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

const DEFAULTS: Record<string, () => object> = {
  message: () => ({ kind: "message", text: "Olá!" }),
  quickreply: () => ({
    kind: "quickreply", text: "Escolha uma opção:", saveAs: "escolha",
    options: [{ id: uid("o"), title: "Opção A" }, { id: uid("o"), title: "Opção B" }],
  }),
  carousel: () => ({
    kind: "carousel",
    cards: [
      { id: uid("c"), title: "Card 1", subtitle: "Subtítulo", buttons: [{ type: "postback", id: uid("b"), title: "Quero" }] },
      { id: uid("c"), title: "Card 2", subtitle: "Subtítulo", buttons: [{ type: "postback", id: uid("b"), title: "Quero" }] },
    ],
  }),
  image: () => ({ kind: "image", url: "https://picsum.photos/600/400" }),
  question: () => ({ kind: "question", text: "Qual seu nome?", saveAs: "nome" }),
  delay: () => ({ kind: "delay", seconds: 3600, window: { fromHour: 8, toHour: 22 } }),
  condition: () => ({ kind: "condition", key: "nome", op: "exists" }),
  action: () => ({ kind: "action", ops: [{ op: "addTag", tagName: "lead" }] }),
  random: () => ({ kind: "random", weights: [50, 50] }),
  end: () => ({ kind: "end" }),
};

export function FlowEditor({
  flowId,
  initial,
  stats,
  onSave,
}: {
  flowId: string;
  initial: FlowGraph;
  stats?: FlowStats;
  onSave: (graph: FlowGraph) => Promise<void>;
}) {
  // Stats ride along in node data so each node can draw its own numbers.
  const seeded = useMemo(
    () => initial.nodes.map((n) => ({ ...n, data: { ...n.data, _stats: stats?.[n.id] } })) as Node[],
    [initial.nodes, stats],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(seeded);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges as Edge[]);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState(true);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, animated: true }, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (kind: string) => {
      setNodes((ns) => [
        ...ns,
        {
          id: uid(kind),
          type: kind,
          position: { x: 160 + Math.random() * 220, y: 80 + ns.length * 130 },
          data: DEFAULTS[kind]!(),
        } as Node,
      ]);
    },
    [setNodes],
  );

  // Strips _stats before validating: it is display state, not flow data.
  const clean = useMemo(
    () => ({
      nodes: nodes.map(({ data, ...n }) => {
        const { _stats, ...rest } = data as Record<string, unknown>;
        return { ...n, data: rest };
      }),
      edges,
    }),
    [nodes, edges],
  );

  const issues: FlowIssue[] = useMemo(() => {
    const parsed = FlowGraph.safeParse(clean);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return [{ level: "error", message: `Campo inválido: ${first?.path.join(".")} — ${first?.message}` }];
    }
    return validateGraph(parsed.data);
  }, [clean]);

  const errors = issues.filter((i) => i.level === "error");

  const save = async () => {
    if (errors.length) return;
    setSaving(true);
    try {
      await onSave(FlowGraph.parse(clean));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* side panel — how a step gets added */}
      {panel && (
        <aside className="w-64 shrink-0 overflow-y-auto border-r bg-white dark:bg-neutral-900 dark:border-neutral-700">
          <div className="border-b px-4 py-3 dark:border-neutral-700">
            <h2 className="text-sm font-semibold">Adicionar bloco</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Clique para inserir no fluxo</p>
          </div>
          <div className="space-y-1 p-2">
            {BLOCKS.map((b) => (
              <button
                key={b.kind}
                onClick={() => addNode(b.kind)}
                className="w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 dark:hover:border-neutral-700"
              >
                <div className={`text-[13px] font-semibold ${b.tone}`}>{b.label}</div>
                <div className="text-[11px] leading-tight text-neutral-500">{b.hint}</div>
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2 dark:border-neutral-700">
          <button
            onClick={() => setPanel((v) => !v)}
            className="rounded border px-2 py-1 text-xs dark:border-neutral-700"
          >
            {panel ? "◀" : "▶"} Blocos
          </button>
          <span className="text-xs text-neutral-500">
            {nodes.length} {nodes.length === 1 ? "passo" : "passos"}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {errors.length > 0 && (
              <span className="text-xs font-medium text-rose-600">
                {errors.length} {errors.length === 1 ? "erro" : "erros"}
              </span>
            )}
            <button
              onClick={save}
              disabled={saving || errors.length > 0}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>

        {issues.length > 0 && (
          <ul className="max-h-24 overflow-y-auto border-b bg-amber-50 px-4 py-1.5 text-[11px] dark:bg-amber-950/30 dark:border-neutral-700">
            {issues.map((i, n) => (
              <li key={n} className={i.level === "error" ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"}>
                {i.level === "error" ? "✗" : "⚠"} {i.message}
              </li>
            ))}
          </ul>
        )}

        <div className="min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.15}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={16} size={1} />
            <Controls />
            <MiniMap zoomable pannable className="!bg-neutral-50 dark:!bg-neutral-800" />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

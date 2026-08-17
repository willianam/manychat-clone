"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background, Controls, MiniMap, addEdge,
  useNodesState, useEdgesState,
  type Connection, type Edge, type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { FlowGraph, validateGraph, type FlowIssue, type FlowNodeData } from "../lib/flow-schema";
import { duplicateNode, pruneOrphanEdges, uid, withInlineText } from "../lib/flow-edit";
import type { FlowStats } from "../server/flow-metrics";
import { nodeTypes } from "./nodes";
import { PropertiesPanel } from "./PropertiesPanel";

/**
 * Flow editor.
 *
 * The canvas renders each node as the message it produces, with delivery
 * numbers in place. Adding a step goes through a side panel rather than a
 * toolbar of bare type names, so the choice is made by what the block does.
 *
 * Editing is split by blast radius: text edits inline on the canvas, while
 * anything that adds or removes an *output* — buttons, quick replies, cards —
 * goes through the properties panel on the right, because those are the edits
 * that can orphan an edge. Every structural change runs through
 * `pruneOrphanEdges` so a detached edge never reaches the runner.
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
  { kind: "album",      label: "Álbum",           hint: "Até 10 imagens numa mensagem só",    tone: "text-sky-600" },
  { kind: "video",      label: "Vídeo",           hint: "Manda um vídeo (até 25 MB)",         tone: "text-fuchsia-600" },
  { kind: "audio",      label: "Áudio",           hint: "Manda um áudio (até 25 MB)",         tone: "text-cyan-600" },
  { kind: "file",       label: "PDF",             hint: "Manda um documento em PDF",          tone: "text-stone-600" },
  { kind: "question",   label: "Coleta de dados", hint: "Espera uma resposta escrita",        tone: "text-amber-600" },
  { kind: "delay",      label: "Atraso",          hint: "Espera, respeitando horário",        tone: "text-rose-600" },
  { kind: "condition",  label: "Condição",        hint: "Divide o caminho em sim / não",      tone: "text-teal-600" },
  { kind: "action",     label: "Ações",           hint: "Marca tags e grava campos",          tone: "text-yellow-600" },
  { kind: "random",     label: "Randomizador",    hint: "Divide o tráfego para testar",       tone: "text-slate-600" },
  { kind: "end",        label: "Fim",             hint: "Encerra a conversa",                 tone: "text-neutral-600" },
];

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
  album: () => ({
    kind: "album",
    urls: ["https://picsum.photos/600/400", "https://picsum.photos/600/401"],
  }),
  video: () => ({ kind: "video", url: "https://exemplo.com/video.mp4" }),
  audio: () => ({ kind: "audio", url: "https://exemplo.com/audio.m4a" }),
  file: () => ({ kind: "file", url: "https://exemplo.com/proposta.pdf", filename: "proposta.pdf" }),
  question: () => ({ kind: "question", text: "Qual seu nome?", saveAs: "nome" }),
  delay: () => ({ kind: "delay", seconds: 3600, window: { fromHour: 8, toHour: 22 } }),
  condition: () => ({ kind: "condition", key: "nome", op: "exists" }),
  action: () => ({ kind: "action", ops: [{ op: "addTag", tagName: "lead" }] }),
  random: () => ({ kind: "random", weights: [50, 50] }),
  end: () => ({ kind: "end" }),
};

export function FlowEditor({
  initial,
  stats,
  onSave,
}: {
  initial: FlowGraph;
  stats?: FlowStats;
  onSave: (graph: FlowGraph) => Promise<void>;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges as Edge[]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [panel, setPanel] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * Replace one node's data, then reap any edge the change orphaned.
   *
   * The pruning is staged through `pendingPrune` rather than run inside the
   * `setNodes` updater: a state updater must stay pure, and nesting a
   * `setEdges` inside one double-fires under StrictMode.
   */
  const [pendingPrune, setPendingPrune] = useState(0);

  const updateNodeData = useCallback(
    (nodeId: string, data: FlowNodeData) => {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data } : n)));
      setPendingPrune((n) => n + 1);
      setSavedAt(null);
    },
    [setNodes],
  );

  useEffect(() => {
    if (pendingPrune === 0) return;
    setEdges(
      (es) =>
        pruneOrphanEdges({
          nodes: nodes as FlowGraph["nodes"],
          edges: es as FlowGraph["edges"],
        }).edges as Edge[],
    );
    // Runs only when a structural edit bumped the counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrune]);

  /**
   * Copy the selected block. The copy lands offset below-right and becomes
   * the selection, so the next edit applies to it rather than the original.
   */
  const duplicate = useCallback(
    (nodeId: string) => {
      const next = duplicateNode(
        { nodes: nodes as FlowGraph["nodes"], edges: edges as FlowGraph["edges"] },
        nodeId,
      );
      const added = next.nodes[next.nodes.length - 1];
      setNodes(next.nodes as Node[]);
      if (added) setSelectedId(added.id);
      setSavedAt(null);
    },
    [nodes, edges, setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== nodeId));
      setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedId((id) => (id === nodeId ? null : id));
      setSavedAt(null);
    },
    [setNodes, setEdges],
  );

  /**
   * Stats and the inline-edit callback ride along in node data so each node
   * can draw its own numbers and commit its own text. Both are stripped
   * before validation — they are display wiring, not flow data.
   */
  const rendered = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          _stats: stats?.[n.id],
          _onText: (text: string) =>
            updateNodeData(n.id, withInlineText(n.data as FlowNodeData, text)),
        },
      })) as Node[],
    [nodes, stats, updateNodeData],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((eds) => addEdge({ ...c, animated: true }, eds));
      setSavedAt(null);
    },
    [setEdges],
  );

  const addNode = useCallback(
    (kind: string) => {
      const id = uid(kind);
      setNodes((ns) => [
        ...ns,
        {
          id,
          type: kind,
          position: { x: 160 + Math.random() * 220, y: 80 + ns.length * 130 },
          data: DEFAULTS[kind]!(),
        } as Node,
      ]);
      setSelectedId(id);
      setSavedAt(null);
    },
    [setNodes],
  );

  /**
   * Delete/Backspace removes the selection. React Flow ships its own delete
   * key handling, but it does not know about our selection state or the
   * "don't delete while typing" rule, so we own it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        const el0 = document.activeElement;
        const typing =
          el0 instanceof HTMLInputElement ||
          el0 instanceof HTMLTextAreaElement ||
          (el0 instanceof HTMLElement && el0.isContentEditable);
        if (!typing && selectedId) {
          e.preventDefault();
          duplicate(selectedId);
        }
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;

      // Never eat a keystroke aimed at a text field.
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      const selectedEdges = edges.filter((x) => x.selected);
      if (selectedEdges.length) {
        e.preventDefault();
        const gone = new Set(selectedEdges.map((x) => x.id));
        setEdges((es) => es.filter((x) => !gone.has(x.id)));
        setSavedAt(null);
        return;
      }

      const target = nodes.find((n) => n.selected) ?? nodes.find((n) => n.id === selectedId);
      if (target) {
        e.preventDefault();
        deleteNode(target.id);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes, edges, selectedId, deleteNode, duplicate, setEdges]);

  // Strips display-only wiring before validating.
  const clean = useMemo(
    () => ({
      nodes: nodes.map(({ data, ...n }) => {
        const { _stats, _onText, ...rest } = data as Record<string, unknown>;
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
    setSaveError(null);
    try {
      await onSave(FlowGraph.parse(clean));
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* side panel — how a step gets added */}
      {panel && (
        <aside className="w-64 shrink-0 overflow-y-auto border-r bg-white">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Adicionar bloco</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Clique para inserir no fluxo</p>
          </div>
          <div className="space-y-1 p-2">
            {BLOCKS.map((b) => (
              <button
                key={b.kind}
                onClick={() => addNode(b.kind)}
                className="w-full rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-neutral-200 hover:bg-neutral-50"
              >
                <div className={`text-[13px] font-semibold ${b.tone}`}>{b.label}</div>
                <div className="text-[11px] leading-tight text-neutral-500">{b.hint}</div>
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <button
            onClick={() => setPanel((v) => !v)}
            className="rounded border px-2 py-1 text-xs"
          >
            {panel ? "◀" : "▶"} Blocos
          </button>
          <span className="text-xs text-neutral-500">
            {nodes.length} {nodes.length === 1 ? "passo" : "passos"}
          </span>
          <span className="hidden text-xs text-neutral-400 sm:inline">
            Duplo clique edita o texto · ⌘D duplica · Delete remove
          </span>
          <div className="ml-auto flex items-center gap-3">
            {saveError && (
              <span className="text-xs font-medium text-rose-600">{saveError}</span>
            )}
            {!saveError && savedAt && !saving && (
              <span className="text-xs font-medium text-emerald-600">
                ✓ Salvo às {timeOf(savedAt)}
              </span>
            )}
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
          <ul className="max-h-24 overflow-y-auto border-b bg-amber-50 px-4 py-1.5 text-[11px]">
            {issues.map((i, n) => (
              <li key={n} className={i.level === "error" ? "text-rose-700" : "text-amber-700"}>
                {i.level === "error" ? "✗" : "⚠"} {i.message}
              </li>
            ))}
          </ul>
        )}

        <div className="min-h-0 flex-1">
          <ReactFlow
            nodes={rendered}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            onEdgesDelete={() => setSavedAt(null)}
            onNodesDelete={(deleted) => {
              setSelectedId((id) => (deleted.some((n) => n.id === id) ? null : id));
              setSavedAt(null);
            }}
            nodeTypes={nodeTypes}
            // We own Delete/Backspace so it can respect focused text fields.
            deleteKeyCode={null}
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

      <PropertiesPanel
        node={selected}
        onChange={(data) => selected && updateNodeData(selected.id, data)}
        onDelete={() => selected && deleteNode(selected.id)}
        onDuplicate={() => selected && duplicate(selected.id)}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

const timeOf = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

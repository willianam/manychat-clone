"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  AlertTriangle,
  BarChart3,
  Check,
  LayoutGrid,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Redo2,
  Save,
  Send,
  Undo2,
  Upload,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StatusPill } from "@/components/ui/status-pill";
import { setUnsaved } from "@/lib/ui/unsaved";
import { FlowGraph, validateGraph, type FlowIssue, type FlowNodeData } from "../lib/flow-schema";
import {
  duplicateNode,
  insertPosition,
  pruneOrphanEdges,
  uid,
  withInlineText,
} from "../lib/flow-edit";
import { clipSelection, parseClip, pasteClip, serializeClip } from "../lib/flow-clipboard";
import { emptyHistory, record, redo, undo } from "../lib/flow-history";
import { layoutGraph } from "../lib/flow-layout";
import type { EditorMetrics } from "../server/flow-editor-metrics";
import { PERIOD_LABEL, STATS_PERIODS, type StatsPeriod } from "../lib/stats-period";
import { FunnelPanel } from "./FunnelPanel";
import { nodeTypes } from "./nodes";
import { PropertiesPanel, type GotoTargets } from "./PropertiesPanel";
import { TriggerNode, TRIGGER_NODE_ID, type TriggerNodeData } from "./TriggerNode";
import type { TriggerView } from "../app/gatilhos/actions";

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
  {
    kind: "message",
    label: "Texto",
    hint: "Mensagem simples, com ou sem botões",
    tone: "text-indigo-600",
  },
  {
    kind: "quickreply",
    label: "Resposta rápida",
    hint: "Opções tocáveis que somem depois",
    tone: "text-amber-600",
  },
  {
    kind: "carousel",
    label: "Carrossel",
    hint: "Cards lado a lado com botões",
    tone: "text-violet-600",
  },
  { kind: "image", label: "Imagem", hint: "Manda uma imagem", tone: "text-sky-600" },
  { kind: "album", label: "Álbum", hint: "Até 10 imagens numa mensagem só", tone: "text-sky-600" },
  { kind: "video", label: "Vídeo", hint: "Manda um vídeo (até 25 MB)", tone: "text-fuchsia-600" },
  { kind: "audio", label: "Áudio", hint: "Manda um áudio (até 25 MB)", tone: "text-cyan-600" },
  { kind: "file", label: "PDF", hint: "Manda um documento em PDF", tone: "text-stone-600" },
  {
    kind: "question",
    label: "Coleta de dados",
    hint: "Espera uma resposta escrita",
    tone: "text-amber-600",
  },
  { kind: "delay", label: "Atraso", hint: "Espera, respeitando horário", tone: "text-rose-600" },
  {
    kind: "condition",
    label: "Condição",
    hint: "Divide o caminho em sim / não",
    tone: "text-teal-600",
  },
  { kind: "action", label: "Ações", hint: "Marca tags e grava campos", tone: "text-yellow-600" },
  {
    kind: "random",
    label: "Randomizador",
    hint: "Divide o tráfego para testar",
    tone: "text-slate-600",
  },
  {
    kind: "goto",
    label: "Ir para",
    hint: "Salta para outro passo ou fluxo",
    tone: "text-violet-600",
  },
  { kind: "goal", label: "Meta", hint: "Marca uma conversão", tone: "text-emerald-600" },
  {
    kind: "request",
    label: "Requisição externa",
    hint: "Chama uma API e grava a resposta",
    tone: "text-orange-600",
  },
  { kind: "end", label: "Fim", hint: "Encerra a conversa", tone: "text-neutral-600" },
];

/** MIME type of a palette drag, so a stray file drop is ignored. */
const DRAG_TYPE = "application/x-flow-block";

type Snapshot = { nodes: Node[]; edges: Edge[] };

/**
 * Last copy made in this tab. The system clipboard is the primary channel
 * (it is what makes paste across flows work), but reading it needs a
 * permission the browser may refuse; this keeps ⌘C/⌘V working regardless.
 */
let memoryClip: string | null = null;

const isTyping = () => {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
};

const DEFAULTS: Record<string, () => object> = {
  message: () => ({ kind: "message", text: "Olá!" }),
  quickreply: () => ({
    kind: "quickreply",
    text: "Escolha uma opção:",
    saveAs: "escolha",
    options: [
      { id: uid("o"), title: "Opção A" },
      { id: uid("o"), title: "Opção B" },
    ],
  }),
  carousel: () => ({
    kind: "carousel",
    cards: [
      {
        id: uid("c"),
        title: "Card 1",
        subtitle: "Subtítulo",
        buttons: [{ type: "postback", id: uid("b"), title: "Quero" }],
      },
      {
        id: uid("c"),
        title: "Card 2",
        subtitle: "Subtítulo",
        buttons: [{ type: "postback", id: uid("b"), title: "Quero" }],
      },
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
  // The target is patched to the flow's entry node on insert (see addNode):
  // a goto pointing nowhere would fail validation before it could be edited.
  goto: () => ({ kind: "goto", target: { nodeId: "" } }),
  goal: () => ({ kind: "goal", name: "Conversão" }),
  request: () => ({ kind: "request", method: "GET", url: "https://api.exemplo.com/consulta" }),
  end: () => ({ kind: "end" }),
};

/**
 * The canvas node table, with the synthetic "Quando…" card added.
 *
 * Built once at module scope: React Flow warns (and remounts every node) when
 * `nodeTypes` is a new object on each render.
 */
const canvasNodeTypes = { ...nodeTypes, __trigger__: TriggerNode };

export function FlowEditor(props: FlowEditorProps) {
  // `useReactFlow` (drop positioning) needs the provider above the canvas.
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

type FlowEditorProps = {
  initial: FlowGraph;
  /** Numbers for the canvas; absent for callers without them (the preview). */
  metrics?: EditorMetrics;
  metricsLoading?: boolean;
  onPeriodChange?: (period: StatsPeriod) => void;
  /** Every flow, for "Ir para outro fluxo". Absent = the selector is empty. */
  flows?: Array<{ id: string; name: string }>;
  /**
   * Triggers of this flow, for the "Quando…" card. These are rows of the
   * `Trigger` table, NOT graph nodes — see TriggerNode.tsx. Undefined means
   * the caller does not want the card at all (the preview, for instance).
   */
  triggers?: TriggerView[];
  onAddTrigger?: () => void;
  onEditTrigger?: (trigger: TriggerView) => void;
  /** Open the "Testar no meu Instagram" dialog. Absent = no button. */
  onTest?: () => void;
  /** Persist the graph as the draft. */
  onSave: (graph: FlowGraph) => Promise<void>;
  /**
   * Draft/published controls. Absent for callers that have no such notion
   * (the preview).
   */
  draft?: {
    hasDraft: boolean;
    publishedAt: string | null;
    onPublish: () => Promise<void>;
    onDiscard: () => Promise<void>;
  };
};

function FlowEditorInner({
  initial,
  metrics,
  metricsLoading,
  onPeriodChange,
  flows,
  triggers,
  onAddTrigger,
  onEditTrigger,
  onTest,
  onSave,
  draft,
}: FlowEditorProps) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges as Edge[]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  /** Edits since the last successful save. */
  const [dirty, setDirty] = useState(false);
  const touch = useCallback(() => {
    touch();
    setDirty(true);
  }, []);

  // The shell's links and the browser both ask before leaving unsaved work.
  useEffect(() => {
    setUnsaved(dirty);
    return () => setUnsaved(false);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers need a value; the text itself is not shown.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [panel, setPanel] = useState(true);
  // Below md the palette is a Sheet rather than a docked column.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stats = metrics?.stats;

  /**
   * Replace one node's data, then reap any edge the change orphaned.
   *
   * The pruning is staged through `pendingPrune` rather than run inside the
   * `setNodes` updater: a state updater must stay pure, and nesting a
   * `setEdges` inside one double-fires under StrictMode.
   */
  const [pendingPrune, setPendingPrune] = useState(0);

  /**
   * Undo/redo. `snap` records the committed state BEFORE a change, read from
   * a ref that tracks the last render, so callers stay free of stale
   * closures. `historyTick` only exists to re-render the toolbar buttons.
   */
  const historyRef = useRef(emptyHistory<Snapshot>());
  const latest = useRef<Snapshot>({ nodes, edges });
  const [, setHistoryTick] = useState(0);
  useEffect(() => {
    latest.current = { nodes, edges };
  }, [nodes, edges]);

  const snap = useCallback((key: string | null = null) => {
    historyRef.current = record(historyRef.current, latest.current, key);
    setHistoryTick((t) => t + 1);
  }, []);

  const restore = useCallback(
    (s: Snapshot) => {
      setNodes(s.nodes);
      setEdges(s.edges);
      setSelectedId(null);
      touch();
      setHistoryTick((t) => t + 1);
    },
    [setNodes, setEdges, touch],
  );

  const undoNow = useCallback(() => {
    const r = undo(historyRef.current, latest.current);
    if (!r) return;
    historyRef.current = r.history;
    restore(r.state);
  }, [restore]);

  const redoNow = useCallback(() => {
    const r = redo(historyRef.current, latest.current);
    if (!r) return;
    historyRef.current = r.history;
    restore(r.state);
  }, [restore]);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  const updateNodeData = useCallback(
    (nodeId: string, data: FlowNodeData) => {
      // Keystrokes into one node's fields fold into a single undo step.
      snap(`data:${nodeId}`);
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data } : n)));
      setPendingPrune((n) => n + 1);
      touch();
    },
    [setNodes, snap, touch],
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
      snap();
      const next = duplicateNode(
        { nodes: nodes as FlowGraph["nodes"], edges: edges as FlowGraph["edges"] },
        nodeId,
      );
      const added = next.nodes[next.nodes.length - 1];
      setNodes(next.nodes as Node[]);
      if (added) setSelectedId(added.id);
      touch();
    },
    [nodes, edges, setNodes, snap, touch],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      snap();
      setNodes((ns) => ns.filter((n) => n.id !== nodeId));
      setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedId((id) => (id === nodeId ? null : id));
      touch();
    },
    [setNodes, setEdges, snap, touch],
  );

  /**
   * Stats and the inline-edit callback ride along in node data so each node
   * can draw its own numbers and commit its own text. Both are stripped
   * before validation — they are display wiring, not flow data.
   */
  const flowNames = useMemo(
    () => Object.fromEntries((flows ?? []).map((f) => [f.id, f.name])),
    [flows],
  );

  const rendered = useMemo(() => {
    const real = nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        _stats: stats?.[n.id],
        _ab: metrics?.ab[n.id],
        _names: flowNames,
        _onText: (text: string) =>
          updateNodeData(n.id, withInlineText(n.data as FlowNodeData, text)),
      },
    })) as Node[];

    if (!triggers) return real;

    /**
     * Inject the "Quando…" card.
     *
     * It is added HERE, to the rendered list, and never to `nodes` state —
     * which is what `clean` (and therefore validation and saving) reads. That
     * is the whole reason a trigger can be drawn on the canvas without ever
     * becoming part of the saved graph.
     *
     * It sits above the flow's entry node so it reads as the first step. It
     * is not an edge target and nothing connects to it, so `validateGraph`'s
     * entry-node count sees exactly the same graph it did before.
     */
    const entry = real.find((n) => !edges.some((e) => e.target === n.id)) ?? real[0];
    const anchor = entry?.position ?? { x: 240, y: 80 };

    const card: Node<TriggerNodeData> = {
      id: TRIGGER_NODE_ID,
      type: "__trigger__",
      position: { x: anchor.x, y: anchor.y - 210 },
      data: {
        triggers,
        onAdd: () => onAddTrigger?.(),
        onEdit: (t) => onEditTrigger?.(t),
      },
      deletable: false,
      draggable: false,
      connectable: false,
      selectable: false,
    };

    return [card as Node, ...real];
  }, [
    nodes,
    edges,
    stats,
    metrics?.ab,
    flowNames,
    updateNodeData,
    triggers,
    onAddTrigger,
    onEditTrigger,
  ]);

  const onConnect = useCallback(
    (c: Connection) => {
      snap();
      setEdges((eds) => addEdge({ ...c, animated: true }, eds));
      touch();
    },
    [setEdges, snap, touch],
  );

  /**
   * Insert a block. Click lands it below the selection (or the last node);
   * a drop lands it where the pointer let go.
   */
  const addNode = useCallback(
    (kind: string, at?: { x: number; y: number }) => {
      snap();
      const id = uid(kind);
      setNodes((ns) => {
        const data = DEFAULTS[kind]!() as Record<string, unknown>;
        if (kind === "goto") {
          const entry = ns.find((n) => !edges.some((e) => e.target === n.id)) ?? ns[0];
          data.target = { nodeId: entry?.id ?? "" };
        }
        return [
          ...ns,
          { id, type: kind, position: at ?? insertPosition(ns, selectedId), data } as Node,
        ];
      });
      setSelectedId(id);
      touch();
    },
    [setNodes, edges, selectedId, snap, touch],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const kind = e.dataTransfer.getData(DRAG_TYPE);
      if (!kind || !(kind in DEFAULTS)) return;
      e.preventDefault();
      addNode(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addNode, screenToFlowPosition],
  );

  // Strips display-only wiring before validating.
  const clean = useMemo(
    () => ({
      nodes: nodes.map(({ data, ...n }) => {
        const rest = { ...(data as Record<string, unknown>) };
        delete rest._stats;
        delete rest._onText;
        delete rest._names;
        delete rest._ab;
        return { ...n, data: rest };
      }),
      edges,
    }),
    [nodes, edges],
  );

  /** Ids to copy: the multi-selection when there is one, else the open node. */
  const selectedIds = useCallback(() => {
    const multi = nodes.filter((n) => n.selected).map((n) => n.id);
    if (multi.length) return multi;
    return selectedId ? [selectedId] : [];
  }, [nodes, selectedId]);

  const copy = useCallback(() => {
    const clip = clipSelection(clean as FlowGraph, selectedIds());
    if (!clip) return;
    const text = serializeClip(clip);
    memoryClip = text;
    navigator.clipboard?.writeText(text).catch(() => {});
  }, [clean, selectedIds]);

  const paste = useCallback(async () => {
    let text = memoryClip;
    try {
      const fromSystem = await navigator.clipboard?.readText();
      if (fromSystem && parseClip(fromSystem)) text = fromSystem;
    } catch {
      // Permission refused: fall back to what this tab copied.
    }
    const clip = text ? parseClip(text) : null;
    if (!clip) return;

    snap();
    const { graph, added } = pasteClip(clean as FlowGraph, clip);
    const pasted = new Set(added);
    setNodes(graph.nodes.map((n) => ({ ...n, selected: pasted.has(n.id) })) as Node[]);
    setEdges(graph.edges as Edge[]);
    setSelectedId(added[0] ?? null);
    touch();
  }, [clean, setNodes, setEdges, snap, touch]);

  /** "Organizar": dagre positions, everything else untouched. */
  const organize = useCallback(() => {
    snap();
    const laid = layoutGraph(clean as FlowGraph);
    const at = new Map(laid.nodes.map((n) => [n.id, n.position]));
    setNodes((ns) => ns.map((n) => ({ ...n, position: at.get(n.id) ?? n.position })));
    touch();
    // Positions land on the next frame; fit the view once they have.
    window.requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
  }, [clean, setNodes, snap, touch, fitView]);

  /**
   * Keyboard. React Flow ships its own delete key handling, but it does not
   * know about our selection state or the "don't delete while typing" rule,
   * so we own every shortcut here.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never eat a keystroke aimed at a text field.
      if (isTyping()) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redoNow();
        else undoNow();
        return;
      }
      if (mod && key === "c") {
        if (selectedIds().length === 0) return;
        e.preventDefault();
        copy();
        return;
      }
      if (mod && key === "v") {
        e.preventDefault();
        void paste();
        return;
      }
      if (mod && key === "d") {
        if (selectedId) {
          e.preventDefault();
          duplicate(selectedId);
        }
        return;
      }

      if (e.key !== "Delete" && e.key !== "Backspace") return;

      const selectedEdges = edges.filter((x) => x.selected);
      if (selectedEdges.length) {
        e.preventDefault();
        snap();
        const gone = new Set(selectedEdges.map((x) => x.id));
        setEdges((es) => es.filter((x) => !gone.has(x.id)));
        touch();
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
  }, [
    nodes,
    edges,
    selectedId,
    deleteNode,
    duplicate,
    setEdges,
    snap,
    touch,
    undoNow,
    redoNow,
    copy,
    paste,
    selectedIds,
  ]);

  const issues: FlowIssue[] = useMemo(() => {
    const parsed = FlowGraph.safeParse(clean);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return [
        { level: "error", message: `Campo inválido: ${first?.path.join(".")} — ${first?.message}` },
      ];
    }
    return validateGraph(parsed.data);
  }, [clean]);

  const errors = issues.filter((i) => i.level === "error");

  /** Save the draft. Resolves true when it went through. */
  const save = async (): Promise<boolean> => {
    if (errors.length) return false;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(FlowGraph.parse(clean));
      setSavedAt(new Date());
      setDirty(false);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Não foi possível salvar.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** Publish = save whatever is unsaved, then promote the draft. */
  const publish = async () => {
    if (!draft || errors.length) return;
    setPublishing(true);
    try {
      if (dirty && !(await save())) return;
      await draft.onPublish();
    } catch {
      // The caller already toasted.
    } finally {
      setPublishing(false);
    }
  };

  const discard = async () => {
    if (!draft) return;
    setDiscarding(true);
    try {
      await draft.onDiscard();
      setDirty(false);
      setConfirmDiscard(false);
    } catch {
      // The caller already toasted.
    } finally {
      setDiscarding(false);
    }
  };

  const draftPending = Boolean(draft && (draft.hasDraft || dirty));

  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const gotoTargets: GotoTargets = useMemo(
    () => ({
      nodes: nodes.map((n) => ({ id: n.id, label: nodeLabel(n) })),
      flows: flows ?? [],
    }),
    [nodes, flows],
  );

  return (
    <div className="relative flex h-full">
      {/*
        The palette. From md up it is a docked column; below md it is a Sheet
        opened from the toolbar, because `hidden md:block` alone left a phone
        with no way at all to add a block.
      */}
      {panel && (
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r bg-card md:block">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Adicionar bloco</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Clique ou arraste para o canvas</p>
          </div>
          <BlockPalette onAdd={addNode} />
        </aside>
      )}

      <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
        <SheetContent side="left" className="w-[280px] overflow-y-auto p-0 sm:max-w-[280px]">
          <div className="border-b px-4 py-3">
            <SheetTitle className="text-sm font-semibold">Adicionar bloco</SheetTitle>
            <p className="mt-0.5 text-xs text-neutral-500">Toque para adicionar ao canvas</p>
          </div>
          <BlockPalette
            onAdd={(kind) => {
              addNode(kind);
              setPaletteOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 overflow-x-auto border-b bg-card px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPanel((v) => !v)}
            aria-pressed={panel}
            className="hidden md:inline-flex"
          >
            {panel ? <PanelLeftClose aria-hidden /> : <PanelLeftOpen aria-hidden />}
            Blocos
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            className="md:hidden"
          >
            <PanelLeftOpen aria-hidden />
            Blocos
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={undoNow}
            disabled={!canUndo}
            aria-label="Desfazer"
            title="Desfazer (⌘Z)"
          >
            <Undo2 aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={redoNow}
            disabled={!canRedo}
            aria-label="Refazer"
            title="Refazer (⌘⇧Z)"
          >
            <Redo2 aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={organize}
            title="Reposiciona os blocos de cima para baixo"
          >
            <LayoutGrid aria-hidden />
            Organizar
          </Button>
          <span className="text-xs text-neutral-500">
            {nodes.length} {nodes.length === 1 ? "passo" : "passos"}
          </span>
          <span className="hidden text-xs text-neutral-400 xl:inline">
            Duplo clique edita o texto · ⌘D duplica · ⌘C/⌘V copia e cola · Delete remove
          </span>
          {onTest && (
            <Button variant="outline" size="sm" onClick={onTest}>
              <Send aria-hidden />
              <span className="hidden lg:inline">Testar no meu Instagram</span>
              <span className="lg:hidden">Testar</span>
            </Button>
          )}
          {metrics && (
            <>
              <Select
                value={metrics.period}
                onValueChange={(v) => onPeriodChange?.(v as StatsPeriod)}
                disabled={!onPeriodChange}
              >
                <SelectTrigger
                  className="h-8 w-[150px] text-xs"
                  aria-label="Período das métricas"
                  aria-busy={metricsLoading}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATS_PERIODS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PERIOD_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFunnelOpen((v) => !v)}
                aria-pressed={funnelOpen}
              >
                <BarChart3 aria-hidden />
                Funil
              </Button>
            </>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span aria-live="polite" className="text-xs font-medium">
              {saveError && <span className="text-rose-600">{saveError}</span>}
              {!saveError && savedAt && !saving && (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  Salvo às {timeOf(savedAt)}
                </span>
              )}
            </span>
            {errors.length > 0 && (
              <span className="text-xs font-medium text-rose-600">
                {errors.length} {errors.length === 1 ? "erro" : "erros"}
              </span>
            )}
            {draft && draftPending && (
              <StatusPill tone="warning">rascunho com alterações</StatusPill>
            )}
            {draft && !draftPending && draft.publishedAt && (
              <span className="hidden text-xs text-neutral-500 lg:inline">
                Publicado em {dateOf(draft.publishedAt)}
              </span>
            )}
            {draft && draftPending && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDiscard(true)}
                disabled={saving || publishing || discarding}
              >
                Descartar rascunho
              </Button>
            )}
            <Button
              size="sm"
              variant={draft ? "outline" : "default"}
              onClick={save}
              disabled={saving || publishing || errors.length > 0}
            >
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
              {saving ? "Salvando…" : draft ? "Salvar rascunho" : "Salvar"}
            </Button>
            {draft && (
              <Button
                size="sm"
                onClick={publish}
                disabled={saving || publishing || errors.length > 0 || !draftPending}
                title={
                  draftPending ? "Copia o rascunho para o fluxo que roda" : "Nada para publicar"
                }
              >
                {publishing ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Upload aria-hidden />
                )}
                {publishing ? "Publicando…" : "Publicar"}
              </Button>
            )}
          </div>
        </div>

        {issues.length > 0 && (
          <ul className="max-h-24 overflow-y-auto border-b bg-amber-50 px-4 py-1.5 text-[11px]">
            {issues.map((i, n) => (
              <li
                key={n}
                className={`flex items-center gap-1 ${i.level === "error" ? "text-rose-700" : "text-amber-700"}`}
              >
                {i.level === "error" ? (
                  <XCircle className="h-3 w-3 shrink-0" aria-hidden />
                ) : (
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                )}
                {i.message}
              </li>
            ))}
          </ul>
        )}

        <div
          className="min-h-0 flex-1"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={rendered}
            edges={edges}
            // Changes to the synthetic card (position, selection) are dropped
            // before they can reach graph state.
            onNodesChange={(changes) =>
              onNodesChange(changes.filter((c) => !("id" in c) || c.id !== TRIGGER_NODE_ID))
            }
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            // The synthetic trigger card is not a graph node: selecting it
            // would open a properties panel for something that cannot be edited.
            onNodeClick={(_, n) => setSelectedId(n.id === TRIGGER_NODE_ID ? null : n.id)}
            onPaneClick={() => setSelectedId(null)}
            onNodeDragStart={() => snap()}
            onEdgesDelete={() => setSavedAt(null)}
            onNodesDelete={(deleted) => {
              setSelectedId((id) => (deleted.some((n) => n.id === id) ? null : id));
              touch();
            }}
            nodeTypes={canvasNodeTypes}
            // We own Delete/Backspace so it can respect focused text fields.
            deleteKeyCode={null}
            // Connections land when the pointer gets close, not only on the 6px dot.
            connectionRadius={40}
            fitView
            minZoom={0.15}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={16} size={1} />
            <Controls />
            <MiniMap zoomable pannable className="!bg-neutral-50" />
          </ReactFlow>
        </div>
      </div>

      {metrics && funnelOpen && (
        <FunnelPanel
          funnel={metrics.funnel}
          labels={Object.fromEntries(gotoTargets.nodes.map((n) => [n.id, n.label]))}
          loading={metricsLoading}
          onClose={() => setFunnelOpen(false)}
        />
      )}

      <PropertiesPanel
        node={selected}
        targets={gotoTargets}
        onChange={(data) => selected && updateNodeData(selected.id, data)}
        onDelete={() => selected && deleteNode(selected.id)}
        onDuplicate={() => selected && duplicate(selected.id)}
        onClose={() => setSelectedId(null)}
      />

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Descartar o rascunho?"
        description="O editor volta para a versão publicada. As alterações não publicadas são perdidas."
        confirmLabel="Descartar"
        destructive
        pending={discarding}
        onConfirm={discard}
      />
    </div>
  );
}

/** The list of blocks, shared by the docked palette and the mobile Sheet. */
function BlockPalette({ onAdd }: { onAdd: (kind: string) => void }) {
  return (
    <div className="space-y-1 p-2">
      {BLOCKS.map((b) => (
        <button
          key={b.kind}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, b.kind);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => onAdd(b.kind)}
          className="w-full cursor-grab rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <div className={`text-[13px] font-semibold ${b.tone}`}>{b.label}</div>
          <div className="text-[11px] leading-tight text-neutral-500">{b.hint}</div>
        </button>
      ))}
    </div>
  );
}

const dateOf = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** "Texto: Olá! (message-ab12)" — enough to pick a step out of a list. */
function nodeLabel(n: Node): string {
  const d = n.data as FlowNodeData;
  const block = BLOCKS.find((b) => b.kind === d.kind)?.label ?? d.kind;
  const text =
    "text" in d && typeof d.text === "string"
      ? d.text
      : d.kind === "goal"
        ? d.name
        : d.kind === "request"
          ? d.url
          : "";
  const short = text.length > 28 ? `${text.slice(0, 28)}…` : text;
  return short ? `${block}: ${short} (${n.id})` : `${block} (${n.id})`;
}

const timeOf = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

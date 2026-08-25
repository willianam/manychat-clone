"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import { useEffect, useRef, useState } from "react";
import type { FlowNodeData } from "../lib/flow-schema";
import { inlineLimitOf } from "../lib/flow-edit";
import type { NodeStats } from "../server/flow-metrics";

/**
 * Canvas nodes.
 *
 * Two ideas carry the design, both borrowed from how ManyChat's builder
 * works:
 *
 *  1. The node renders what the message will actually look like — real
 *     button pills, real quick-reply chips, real cards. You approve the copy
 *     by looking at it, not by imagining it.
 *
 *  2. Delivery numbers live on the node. Seeing "689 enviado · 15% clicado"
 *     in place means you spot where a flow leaks without opening a report.
 *
 * Stats arrive through node data as `_stats`, injected by the editor.
 *
 * Editing works in two places, split by what the edit can break:
 *
 *  - **Text, inline.** Double-click the bubble and type. This is the edit you
 *    make constantly, and it cannot invalidate the graph — no id moves, no
 *    output appears or disappears.
 *
 *  - **Structure, in the properties panel.** Adding a button or removing a
 *    quick reply changes the node's outputs, which changes which edges are
 *    still legal. That belongs somewhere with room to explain itself.
 *
 * The commit callback rides in node data as `_onText`, injected by the editor
 * the same way `_stats` is.
 */

type WithStats = FlowNodeData & {
  _stats?: NodeStats;
  /** Commit an inline text edit for this node. Absent = read-only canvas. */
  _onText?: (text: string) => void;
};

/**
 * Handle styling.
 *
 * The visible dot stays small so the canvas reads clean, but the hit area is
 * deliberately much larger — React Flow uses the element's box for hit
 * testing, so padding the element makes the target forgiving without making
 * the dot look clumsy. Paired with connectionRadius={40} on the canvas, a
 * connection lands when you get close rather than when you land on 6px.
 */
const HANDLE =
  "!h-3 !w-3 !border-2 !border-white !shadow-sm hover:!scale-125 !transition-transform";

const SHELL = "rounded-xl border bg-white shadow-sm text-sm";

/** Colored header strip, the way each node announces its kind. */
function Head({ tone, label, right }: { tone: string; label: string; right?: React.ReactNode }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-t-xl px-2.5 py-1.5 text-[11px] font-semibold ${tone}`}
    >
      <span>{label}</span>
      {right}
    </div>
  );
}

/** The sent / delivered / clicked row. Hidden until a flow has run. */
function Stats({ s }: { s?: NodeStats }) {
  if (!s || s.sent === 0) return null;
  return (
    <div className="flex gap-3 border-b px-2.5 py-1.5 text-center">
      <Metric value={String(s.sent)} label="Enviado" tone="text-neutral-700" />
      {s.deliveredPct !== null && (
        <Metric value={`${s.deliveredPct}%`} label="Entregue" tone="text-emerald-600" />
      )}
      {s.clickedPct !== null && (
        <Metric value={`${s.clickedPct}%`} label="Clicado" tone="text-indigo-600" />
      )}
    </div>
  );
}

function Metric({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="flex-1">
      <div className={`text-[13px] font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-neutral-400">{label}</div>
    </div>
  );
}

/** The message bubble look, as it appears in the DM. */
const BUBBLE =
  "whitespace-pre-wrap rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[12px] leading-snug text-neutral-800";

/**
 * A bubble whose text edits in place. The editing textarea carries its own
 * padding, so the bubble chrome applies only in display mode — otherwise the
 * text jumps as you enter and leave edit mode.
 */
function EditableBubble({
  text,
  onCommit,
  max,
}: {
  text: string;
  onCommit?: (t: string) => void;
  max: number;
}) {
  return <EditableText value={text} onCommit={onCommit} max={max} className={BUBBLE} />;
}

/**
 * Text that becomes a textarea on double-click.
 *
 * Enter commits, Shift+Enter adds a newline, Esc restores the original, blur
 * commits. `nodrag`/`nowheel` keep React Flow from stealing the pointer while
 * you are selecting text inside the node.
 */
function EditableText({
  value,
  onCommit,
  max,
  placeholder,
  className,
}: {
  value: string;
  onCommit?: (text: string) => void;
  max: number;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Re-sync when the panel edits the same field we are mirroring.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    // An empty message would fail schema validation; treat it as a cancel.
    if (next === "" || next === value) {
      setDraft(value);
      return;
    }
    onCommit?.(next);
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={draft}
        maxLength={max}
        rows={Math.min(8, Math.max(2, draft.split("\n").length + 1))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
          // Delete/Backspace inside the textarea must not delete the node.
          e.stopPropagation();
        }}
        className="nodrag nowheel w-full resize-none rounded-lg border border-indigo-400 bg-white px-2.5 py-1.5 text-[12px] leading-snug outline-none"
      />
    );
  }

  return (
    <div
      onDoubleClick={() => onCommit && setEditing(true)}
      title={onCommit ? "Duplo clique para editar" : undefined}
      className={`${className ?? ""} ${
        onCommit ? "cursor-text hover:ring-1 hover:ring-indigo-300" : ""
      }`}
    >
      {value === "" ? <span className="text-neutral-400">{placeholder ?? "…"}</span> : value}
    </div>
  );
}

/** An outbound port with the real button pill it corresponds to. */
function PortButton({
  id,
  title,
  ctr,
  external,
}: {
  id: string;
  title: string;
  ctr?: number;
  external?: boolean;
}) {
  return (
    <div className="relative mt-1">
      <div className="flex items-center justify-center gap-1 rounded-full border border-neutral-200 py-1 text-[12px] font-semibold text-indigo-600">
        <span>{title}</span>
        {external && <span className="text-[10px]">↗</span>}
        {ctr !== undefined && ctr > 0 && (
          <span className="text-[9px] font-medium text-neutral-400">CTR {ctr}%</span>
        )}
      </div>
      {!external && (
        <Handle
          type="source"
          position={Position.Right}
          id={id}
          className={`${HANDLE} !right-[-14px] !bg-indigo-500`}
        />
      )}
    </div>
  );
}

const T = Position.Top;
const B = Position.Bottom;

export function MessageNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "message" }> & { _stats?: NodeStats };
  const s = data._stats;
  const postbacks = (d.buttons ?? []).filter((b) => b.type === "postback");

  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head
        tone="bg-emerald-50 text-emerald-800 border-b border-emerald-100"
        label="Enviar mensagem"
      />
      <Stats s={s} />
      <div className="p-2.5">
        <EditableBubble text={d.text} onCommit={data._onText} max={inlineLimitOf(d)} />
        {(d.buttons ?? []).map((b) => (
          <PortButton
            key={b.id}
            id={b.id}
            title={b.title}
            external={b.type === "url"}
            ctr={
              s?.byHandle[b.id] && s.sent
                ? Math.round((s.byHandle[b.id]! / s.sent) * 100)
                : undefined
            }
          />
        ))}
      </div>
      <NextStep />
    </div>
  );
}

/**
 * The "Próximo Passo" port.
 *
 * Every sending node has one, including nodes that also carry buttons. On a
 * node with buttons this is the path taken when the contact taps nothing —
 * without it a button-bearing node is a dead end for everyone who ignores
 * the buttons, which is most people.
 */
function NextStep() {
  return (
    <div className="relative flex items-center justify-end gap-1.5 border-t border-neutral-100 px-2.5 py-1.5">
      <span className="text-[10px] text-neutral-400">Próximo Passo</span>
      <Handle
        type="source"
        position={Position.Right}
        id="next"
        className={`${HANDLE} !relative !right-0 !top-0 !transform-none !bg-neutral-400`}
      />
    </div>
  );
}

export function QuestionNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "question" }> & { _stats?: NodeStats };
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-amber-50 text-amber-800 border-b border-amber-100" label="Perguntar" />
      <Stats s={data._stats} />
      <div className="p-2.5">
        <EditableBubble text={d.text} onCommit={data._onText} max={inlineLimitOf(d)} />
        <div className="mt-1.5 rounded border border-dashed border-neutral-300 px-2 py-1 text-[11px] text-neutral-500">
          resposta livre → <span className="font-mono">{d.saveAs}</span>
        </div>
      </div>
      <NextStep />
    </div>
  );
}

export function QuickReplyNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "quickreply" }> & { _stats?: NodeStats };
  const s = data._stats;
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-amber-50 text-amber-800 border-b border-amber-100" label="Resposta rápida" />
      <Stats s={s} />
      <div className="p-2.5">
        <EditableBubble text={d.text} onCommit={data._onText} max={inlineLimitOf(d)} />
        <div className="mt-1.5 space-y-1">
          {d.options.map((o) => (
            <div key={o.id} className="relative">
              <div className="inline-flex items-center gap-1 rounded-full border border-indigo-300 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600">
                {o.title}
                {s?.byHandle[o.id] ? (
                  <span className="text-[9px] font-medium text-neutral-400">
                    {s.byHandle[o.id]}
                  </span>
                ) : null}
              </div>
              <Handle
                type="source"
                position={Position.Right}
                id={o.id}
                className={`${HANDLE} !right-[-14px] !bg-amber-500`}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 text-[10px] text-neutral-400">
          salva em <span className="font-mono">{d.saveAs}</span>
        </div>
      </div>
      <NextStep />
    </div>
  );
}

/**
 * Carousel. Compact by default and expandable in place — 10 cards at full
 * size would be ~1800px and swallow the canvas, but hiding them behind a
 * side panel means you can't see the flow you're editing.
 */
export function CarouselNode({ data, id }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "carousel" }> & { _stats?: NodeStats };
  const [open, setOpen] = useState(d.expanded ?? false);
  const s = data._stats;

  return (
    <div className={`${SHELL} ${open ? "w-[420px]" : "w-[248px]"}`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head
        tone="bg-violet-50 text-violet-800 border-b border-violet-100"
        label={`Carrossel · ${d.cards.length} ${d.cards.length === 1 ? "card" : "cards"}`}
        right={
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded px-1 text-[13px] leading-none hover:bg-violet-100"
            aria-label={open ? "Recolher" : "Expandir"}
          >
            {open ? "⤡" : "⤢"}
          </button>
        }
      />
      <Stats s={s} />
      <div className="overflow-x-auto p-2.5">
        <div className="flex gap-2">
          {(open ? d.cards : d.cards.slice(0, 3)).map((c) => (
            <div
              key={c.id}
              className={`shrink-0 overflow-hidden rounded-lg border ${open ? "w-[128px]" : "w-[64px]"}`}
            >
              <div
                className={`flex items-center justify-center bg-neutral-100 text-[9px] text-neutral-400 ${open ? "h-[72px]" : "h-[40px]"}`}
                style={
                  c.imageUrl
                    ? {
                        backgroundImage: `url(${c.imageUrl})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              >
                {!c.imageUrl && (open ? "imagem" : "")}
              </div>
              {open && (
                <>
                  <div className="truncate px-1.5 pt-1 text-[11px] font-semibold">{c.title}</div>
                  {c.subtitle && (
                    <div className="truncate px-1.5 pb-1 text-[10px] text-neutral-500">
                      {c.subtitle}
                    </div>
                  )}
                  {(c.buttons ?? []).map((b) => (
                    <div key={b.id} className="relative border-t">
                      <div className="py-1 text-center text-[10px] font-semibold text-indigo-600">
                        {b.title}
                      </div>
                      {b.type === "postback" && (
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={b.id}
                          className={`${HANDLE} !right-[-14px] !bg-violet-500`}
                        />
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
          {!open && d.cards.length > 3 && (
            <div className="self-center text-[10px] text-neutral-400">+{d.cards.length - 3}</div>
          )}
        </div>
      </div>
      <NextStep />
    </div>
  );
}

export function ImageNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "image" }> & { _stats?: NodeStats };
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-sky-50 text-sky-800 border-b border-sky-100" label="Imagem" />
      <Stats s={data._stats} />
      <div className="p-2.5">
        <div
          className="flex h-[86px] items-center justify-center rounded-lg bg-neutral-100 text-[10px] text-neutral-400"
          style={{
            backgroundImage: `url(${d.url ?? "arquivo enviado"})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="mt-1.5 text-[11px] text-neutral-600">
          <EditableText
            value={d.caption ?? ""}
            onCommit={data._onText}
            max={inlineLimitOf(d)}
            placeholder="sem legenda"
          />
        </div>
      </div>
      <Handle type="source" position={B} className={`${HANDLE} !bottom-[-8px] !bg-neutral-400`} />
    </div>
  );
}

/**
 * Video, audio and PDF.
 *
 * These have no thumbnail we can render — the URL points at a file we do not
 * fetch — so the preview is an honest placeholder plus the filename, which is
 * the part that tells you *which* asset this block sends. Showing a fake
 * player would suggest a preview we don't have.
 */
function MediaCard({ icon, url, label }: { icon: string; url: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-neutral-100 px-2.5 py-2">
      <span className="text-[18px] leading-none">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium text-neutral-700">{label}</div>
        <div className="truncate text-[9px] text-neutral-400" title={url}>
          {basenameOf(url)}
        </div>
      </div>
    </div>
  );
}

export function VideoNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "video" }>;
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-fuchsia-50 text-fuchsia-700" label="Vídeo" />
      <Stats s={data._stats} />
      <div className="p-2.5">
        <MediaCard icon="▶" url={d.url ?? ""} label="Vídeo" />
      </div>
      <Handle type="source" position={B} className={`${HANDLE} !bottom-[-8px] !bg-neutral-400`} />
    </div>
  );
}

export function AudioNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "audio" }>;
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-cyan-50 text-cyan-700" label="Áudio" />
      <Stats s={data._stats} />
      <div className="p-2.5">
        <MediaCard icon="♪" url={d.url ?? ""} label="Áudio" />
      </div>
      <Handle type="source" position={B} className={`${HANDLE} !bottom-[-8px] !bg-neutral-400`} />
    </div>
  );
}

export function FileNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "file" }>;
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-stone-100 text-stone-700" label="PDF" />
      <Stats s={data._stats} />
      <div className="p-2.5">
        <MediaCard icon="▤" url={d.url ?? ""} label={d.filename ?? "Documento PDF"} />
      </div>
      <Handle type="source" position={B} className={`${HANDLE} !bottom-[-8px] !bg-neutral-400`} />
    </div>
  );
}

/** Album: a thumbnail grid, since these URLs *are* images we can render. */
export function AlbumNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "album" }>;
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head
        tone="bg-sky-50 text-sky-800 border-b border-sky-100"
        label={`Álbum · ${d.urls.length} ${d.urls.length === 1 ? "imagem" : "imagens"}`}
      />
      <Stats s={data._stats} />
      <div className="grid grid-cols-3 gap-1 p-2.5">
        {d.urls.slice(0, 6).map((u, i) => (
          <div
            key={`${u}-${i}`}
            className="h-[46px] rounded bg-neutral-100"
            style={{
              backgroundImage: `url(${u})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ))}
        {d.urls.length > 6 && (
          <div className="flex h-[46px] items-center justify-center rounded bg-neutral-100 text-[10px] text-neutral-500">
            +{d.urls.length - 6}
          </div>
        )}
      </div>
      <Handle type="source" position={B} className={`${HANDLE} !bottom-[-8px] !bg-neutral-400`} />
    </div>
  );
}

/** Last path segment of a URL, for naming a file we can't preview. */
function basenameOf(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split("/").filter(Boolean).pop() ?? url);
  } catch {
    return url;
  }
}

export function ConditionNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "condition" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-cyan-50 text-cyan-800 border-b border-cyan-100" label="Condição" />
      <div className="p-2.5">
        <div className="rounded border px-2 py-1 font-mono text-[11px]">
          {d.key} {d.op} {d.value ?? ""}
        </div>
        <div className="mt-2 flex justify-between text-[11px] font-semibold">
          <span className="text-emerald-600">sim</span>
          <span className="text-rose-600">não</span>
        </div>
      </div>
      <Handle
        type="source"
        position={B}
        id="true"
        style={{ left: "25%" }}
        className={`${HANDLE} !bottom-[-8px] !bg-emerald-500`}
      />
      <Handle
        type="source"
        position={B}
        id="false"
        style={{ left: "75%" }}
        className={`${HANDLE} !bottom-[-8px] !bg-rose-500`}
      />
    </div>
  );
}

export function DelayNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "delay" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-rose-50 text-rose-800 border-b border-rose-100" label="Atraso inteligente" />
      <div className="p-2.5 text-[12px] text-neutral-700">
        Aguarde <b>{humanize(d.seconds)}</b>
        {d.window && (
          <>
            {" "}
            e continue entre{" "}
            <b>
              {pad(d.window.fromHour)}:00–{pad(d.window.toHour)}:00
            </b>
          </>
        )}
      </div>
      <Handle type="source" position={B} className={`${HANDLE} !bottom-[-8px] !bg-neutral-400`} />
    </div>
  );
}

export function ActionNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "action" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-yellow-50 text-yellow-800 border-b border-yellow-100" label="Ações" />
      <div className="space-y-0.5 p-2.5 text-[11px] text-neutral-700">
        {d.ops.map((o, i) => (
          <div key={i}>
            {o.op === "addTag" && (
              <>
                + tag <b>{o.tagName}</b>
              </>
            )}
            {o.op === "removeTag" && (
              <>
                − tag <b>{o.tagName}</b>
              </>
            )}
            {o.op === "setField" && (
              <>
                definir <b>{o.key}</b> = {o.value}
              </>
            )}
            {o.op === "unsetField" && (
              <>
                limpar <b>{o.key}</b>
              </>
            )}
            {o.op === "unsubscribe" && <>cancelar inscrição</>}
            {o.op === "resubscribe" && <>reativar inscrição</>}
          </div>
        ))}
      </div>
      <Handle type="source" position={B} className={`${HANDLE} !bottom-[-8px] !bg-neutral-400`} />
    </div>
  );
}

export function RandomNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "random" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-slate-100 text-slate-700 border-b border-slate-200" label="Randomizador" />
      <div className="p-2.5">
        {d.weights.map((w, i) => (
          <div key={i} className="relative mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full bg-slate-400" style={{ width: `${w}%` }} />
            </div>
            <span className="w-8 text-right text-[11px] tabular-nums text-neutral-500">{w}%</span>
            <Handle
              type="source"
              position={Position.Right}
              id={String(i)}
              className={`${HANDLE} !right-[-14px] !bg-slate-400`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GotoNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "goto" }>;
  const target = "flowId" in d.target ? `fluxo ${d.target.flowId}` : `passo ${d.target.nodeId}`;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-violet-50 text-violet-800 border-b border-violet-100" label="Ir para" />
      <div className="p-2.5 font-mono text-[11px] text-neutral-700">→ {target}</div>
    </div>
  );
}

/** Legacy tag node — superseded by Ações, kept so old flows still render. */
export function TagNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "tag" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <Head tone="bg-yellow-50 text-yellow-800 border-b border-yellow-100" label="Tag" />
      <div className="flex items-center gap-1 p-2.5 text-[12px]">
        <span>{d.action === "add" ? "+" : "−"}</span>
        <EditableText
          value={d.tagName}
          onCommit={data._onText}
          max={inlineLimitOf(d)}
          className="flex-1 font-semibold"
        />
      </div>
      <Handle type="source" position={B} className={`${HANDLE} !bottom-[-8px] !bg-neutral-400`} />
    </div>
  );
}

export function EndNode() {
  return (
    <div className={`${SHELL} w-[140px]`}>
      <Handle type="target" position={T} className={`${HANDLE} !top-[-8px] !bg-neutral-400`} />
      <div className="px-2.5 py-2 text-center text-[12px] font-semibold text-neutral-500">Fim</div>
    </div>
  );
}

function humanize(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)} dias`;
}

const pad = (h: number) => String(h).padStart(2, "0");

export const nodeTypes = {
  message: MessageNode,
  question: QuestionNode,
  quickreply: QuickReplyNode,
  carousel: CarouselNode,
  image: ImageNode,
  video: VideoNode,
  audio: AudioNode,
  file: FileNode,
  album: AlbumNode,
  condition: ConditionNode,
  delay: DelayNode,
  action: ActionNode,
  random: RandomNode,
  tag: TagNode,
  goto: GotoNode,
  end: EndNode,
};

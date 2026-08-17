"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import { useState } from "react";
import type { FlowNodeData } from "../lib/flow-schema";
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
 */

type WithStats = FlowNodeData & { _stats?: NodeStats };

const SHELL =
  "rounded-xl border bg-white shadow-sm dark:bg-neutral-900 dark:border-neutral-700 text-sm";

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
    <div className="flex gap-3 border-b px-2.5 py-1.5 text-center dark:border-neutral-700">
      <Metric value={String(s.sent)} label="Enviado" tone="text-neutral-700 dark:text-neutral-200" />
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

/** A message bubble, drawn as it appears in the DM. */
function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="whitespace-pre-wrap rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[12px] leading-snug text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
      {children}
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
      <div className="flex items-center justify-center gap-1 rounded-full border border-neutral-200 py-1 text-[12px] font-semibold text-indigo-600 dark:border-neutral-700">
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
          className="!right-[-11px] !h-2 !w-2 !border-2 !border-white !bg-indigo-500 dark:!border-neutral-900"
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
      <Handle type="target" position={T} />
      <Head tone="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" label="Enviar mensagem" />
      <Stats s={s} />
      <div className="p-2.5">
        <Bubble>{d.text}</Bubble>
        {(d.buttons ?? []).map((b) => (
          <PortButton
            key={b.id}
            id={b.id}
            title={b.title}
            external={b.type === "url"}
            ctr={s?.byHandle[b.id] && s.sent ? Math.round((s.byHandle[b.id]! / s.sent) * 100) : undefined}
          />
        ))}
      </div>
      {postbacks.length === 0 && <Handle type="source" position={B} />}
    </div>
  );
}

export function QuestionNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "question" }> & { _stats?: NodeStats };
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} />
      <Head tone="bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" label="Perguntar" />
      <Stats s={data._stats} />
      <div className="p-2.5">
        <Bubble>{d.text}</Bubble>
        <div className="mt-1.5 rounded border border-dashed border-neutral-300 px-2 py-1 text-[11px] text-neutral-500 dark:border-neutral-600">
          resposta livre → <span className="font-mono">{d.saveAs}</span>
        </div>
      </div>
      <Handle type="source" position={B} />
    </div>
  );
}

export function QuickReplyNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "quickreply" }> & { _stats?: NodeStats };
  const s = data._stats;
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} />
      <Head tone="bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" label="Resposta rápida" />
      <Stats s={s} />
      <div className="p-2.5">
        <Bubble>{d.text}</Bubble>
        <div className="mt-1.5 space-y-1">
          {d.options.map((o) => (
            <div key={o.id} className="relative">
              <div className="inline-flex items-center gap-1 rounded-full border border-indigo-300 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-600 dark:border-indigo-700">
                {o.title}
                {s?.byHandle[o.id] ? (
                  <span className="text-[9px] font-medium text-neutral-400">{s.byHandle[o.id]}</span>
                ) : null}
              </div>
              <Handle
                type="source"
                position={Position.Right}
                id={o.id}
                className="!right-[-11px] !h-2 !w-2 !border-2 !border-white !bg-amber-500 dark:!border-neutral-900"
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 text-[10px] text-neutral-400">
          salva em <span className="font-mono">{d.saveAs}</span>
        </div>
      </div>
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
      <Handle type="target" position={T} />
      <Head
        tone="bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
        label={`Carrossel · ${d.cards.length} ${d.cards.length === 1 ? "card" : "cards"}`}
        right={
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded px-1 text-[13px] leading-none hover:bg-violet-100 dark:hover:bg-violet-900"
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
              className={`shrink-0 overflow-hidden rounded-lg border dark:border-neutral-700 ${open ? "w-[128px]" : "w-[64px]"}`}
            >
              <div
                className={`flex items-center justify-center bg-neutral-100 text-[9px] text-neutral-400 dark:bg-neutral-800 ${open ? "h-[72px]" : "h-[40px]"}`}
                style={
                  c.imageUrl
                    ? { backgroundImage: `url(${c.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : undefined
                }
              >
                {!c.imageUrl && (open ? "imagem" : "")}
              </div>
              {open && (
                <>
                  <div className="truncate px-1.5 pt-1 text-[11px] font-semibold">{c.title}</div>
                  {c.subtitle && (
                    <div className="truncate px-1.5 pb-1 text-[10px] text-neutral-500">{c.subtitle}</div>
                  )}
                  {(c.buttons ?? []).map((b) => (
                    <div key={b.id} className="relative border-t dark:border-neutral-700">
                      <div className="py-1 text-center text-[10px] font-semibold text-indigo-600">
                        {b.title}
                      </div>
                      {b.type === "postback" && (
                        <Handle
                          type="source"
                          position={Position.Right}
                          id={b.id}
                          className="!right-[-11px] !h-2 !w-2 !border-2 !border-white !bg-violet-500 dark:!border-neutral-900"
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
      {!d.cards.some((c) => c.buttons?.some((b) => b.type === "postback")) && (
        <Handle type="source" position={B} />
      )}
    </div>
  );
}

export function ImageNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "image" }> & { _stats?: NodeStats };
  return (
    <div className={`${SHELL} w-[248px]`}>
      <Handle type="target" position={T} />
      <Head tone="bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300" label="Imagem" />
      <Stats s={data._stats} />
      <div className="p-2.5">
        <div
          className="flex h-[86px] items-center justify-center rounded-lg bg-neutral-100 text-[10px] text-neutral-400 dark:bg-neutral-800"
          style={{ backgroundImage: `url(${d.url})`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
        {d.caption && <div className="mt-1.5 text-[11px] text-neutral-600">{d.caption}</div>}
      </div>
      <Handle type="source" position={B} />
    </div>
  );
}

export function ConditionNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "condition" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} />
      <Head tone="bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300" label="Condição" />
      <div className="p-2.5">
        <div className="rounded border px-2 py-1 font-mono text-[11px] dark:border-neutral-700">
          {d.key} {d.op} {d.value ?? ""}
        </div>
        <div className="mt-2 flex justify-between text-[11px] font-semibold">
          <span className="text-emerald-600">sim</span>
          <span className="text-rose-600">não</span>
        </div>
      </div>
      <Handle type="source" position={B} id="true" style={{ left: "25%" }} className="!bg-emerald-500" />
      <Handle type="source" position={B} id="false" style={{ left: "75%" }} className="!bg-rose-500" />
    </div>
  );
}

export function DelayNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "delay" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} />
      <Head tone="bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300" label="Atraso inteligente" />
      <div className="p-2.5 text-[12px] text-neutral-700 dark:text-neutral-200">
        Aguarde <b>{humanize(d.seconds)}</b>
        {d.window && (
          <> e continue entre <b>{pad(d.window.fromHour)}:00–{pad(d.window.toHour)}:00</b></>
        )}
      </div>
      <Handle type="source" position={B} />
    </div>
  );
}

export function ActionNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "action" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} />
      <Head tone="bg-yellow-50 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-300" label="Ações" />
      <div className="space-y-0.5 p-2.5 text-[11px] text-neutral-700 dark:text-neutral-200">
        {d.ops.map((o, i) => (
          <div key={i}>
            {o.op === "addTag" && <>+ tag <b>{o.tagName}</b></>}
            {o.op === "removeTag" && <>− tag <b>{o.tagName}</b></>}
            {o.op === "setField" && <>definir <b>{o.key}</b> = {o.value}</>}
            {o.op === "unsetField" && <>limpar <b>{o.key}</b></>}
          </div>
        ))}
      </div>
      <Handle type="source" position={B} />
    </div>
  );
}

export function RandomNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "random" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} />
      <Head tone="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" label="Randomizador" />
      <div className="p-2.5">
        {d.weights.map((w, i) => (
          <div key={i} className="relative mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full bg-slate-400" style={{ width: `${w}%` }} />
            </div>
            <span className="w-8 text-right text-[11px] tabular-nums text-neutral-500">{w}%</span>
            <Handle
              type="source"
              position={Position.Right}
              id={String(i)}
              className="!right-[-11px] !h-2 !w-2 !border-2 !border-white !bg-slate-400 dark:!border-neutral-900"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Legacy tag node — superseded by Ações, kept so old flows still render. */
export function TagNode({ data }: NodeProps<WithStats>) {
  const d = data as Extract<FlowNodeData, { kind: "tag" }>;
  return (
    <div className={`${SHELL} w-[224px]`}>
      <Handle type="target" position={T} />
      <Head tone="bg-yellow-50 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-300" label="Tag" />
      <div className="p-2.5 text-[12px]">
        {d.action === "add" ? "+" : "−"} <b>{d.tagName}</b>
      </div>
      <Handle type="source" position={B} />
    </div>
  );
}

export function EndNode() {
  return (
    <div className={`${SHELL} w-[140px]`}>
      <Handle type="target" position={T} />
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
  condition: ConditionNode,
  delay: DelayNode,
  action: ActionNode,
  random: RandomNode,
  tag: TagNode,
  end: EndNode,
};

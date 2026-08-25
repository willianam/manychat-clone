"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import { describeTrigger } from "../lib/trigger-rules";
import type { TriggerView } from "../app/gatilhos/actions";

/**
 * The "Quando…" card — the first thing on the canvas, the way ManyChat opens
 * every automation.
 *
 * This node is SYNTHETIC. Triggers are rows in the `Trigger` table, not nodes
 * in `Flow.graph`, so this card is injected by the editor at render time and
 * stripped before anything is validated or saved. Three properties keep that
 * safe, and all three are set by the editor rather than here:
 *
 *   - it carries a reserved id (`TRIGGER_NODE_ID`) that the save path filters
 *     out, so it can never reach `FlowGraph.parse` or `validateGraph`;
 *   - `deletable: false` and `connectable: false`, so no edge can ever be
 *     drawn to or from it and Delete cannot remove it;
 *   - it is positioned above the real entry node and is not an edge target,
 *     so the "nós de entrada" count the validator does is unaffected.
 *
 * Green border, because in ManyChat green is the colour of "this is where it
 * starts" and the owner has been staring at that product.
 */

/** Reserved id. Must never collide with a real node id (uid uses "kind_...") */
export const TRIGGER_NODE_ID = "__trigger_card__";

export type TriggerNodeData = {
  triggers: TriggerView[];
  onAdd: () => void;
  onEdit: (trigger: TriggerView) => void;
};

export function TriggerNode({ data }: NodeProps<TriggerNodeData>) {
  const { triggers, onAdd, onEdit } = data;

  return (
    <div className="w-[268px] rounded-xl border-2 border-emerald-400 bg-white text-sm shadow-sm">
      <div className="flex items-center gap-1.5 rounded-t-[9px] border-b border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800">
        <span>Quando…</span>
        <span className="ml-auto font-normal text-emerald-600">
          {triggers.length} {triggers.length === 1 ? "gatilho" : "gatilhos"}
        </span>
      </div>

      <div className="space-y-1 p-2">
        {triggers.length === 0 && (
          <p className="px-1 py-2 text-[11px] leading-snug text-neutral-500">
            Este fluxo ainda não tem gatilho — nada faz ele começar. Adicione um para que o
            Instagram possa dispará-lo.
          </p>
        )}

        {triggers.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onEdit(t)}
            className="nodrag w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-left transition hover:border-emerald-300 hover:bg-emerald-50"
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  t.enabled ? "bg-emerald-500" : "bg-neutral-300"
                }`}
                title={t.enabled ? "Ativo" : "Desativado"}
              />
              <span className="truncate text-[12px] font-medium">{describeTrigger(t)}</span>
            </div>
            {t.mediaId && (
              <div className="mt-0.5 pl-3 text-[10px] text-neutral-500">
                só numa publicação específica
              </div>
            )}
          </button>
        ))}

        <button
          type="button"
          onClick={onAdd}
          className="nodrag w-full rounded-lg border border-dashed border-emerald-300 px-2 py-1.5 text-[12px] font-medium text-emerald-700 transition hover:bg-emerald-50"
        >
          + Novo Gatilho
        </button>
      </div>

      {/* Decorative only: not connectable, so no edge can ever attach here. */}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!h-2 !w-2 !border-2 !border-white !bg-emerald-400 !bottom-[-5px]"
      />
    </div>
  );
}

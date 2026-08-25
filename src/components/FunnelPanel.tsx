"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FlowFunnel } from "../server/flow-funnel";

/**
 * The "Funil" side panel: how many runs started in the period, how they
 * ended, and how far they got, node by node in graph order.
 *
 * Bars are relative to `started`, so a node at 40% means four in ten runs
 * reached it — the leak is wherever the bars drop. Silent nodes (condition,
 * action, random) never send and never park a session, so they read 0; the
 * label says so rather than pretending the number is real.
 */
const SILENT = new Set(["condition", "action", "tag", "random", "goto", "goal"]);

export function FunnelPanel({
  funnel,
  labels,
  loading,
  onClose,
}: {
  funnel: FlowFunnel | null;
  /** Node id → short label, from the editor. */
  labels: Record<string, string>;
  loading?: boolean;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Funil do fluxo"
      // Overlays the canvas below md, docks from md up — same rule as the
      // properties panel, so the two never squeeze the canvas on a phone.
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[min(18rem,100vw)] flex-col overflow-y-auto border-l bg-card shadow-xl md:static md:z-auto md:w-72 md:shrink-0 md:shadow-none"
      aria-busy={loading}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="flex-1 text-sm font-semibold">Funil</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar funil">
          <X aria-hidden />
        </Button>
      </div>

      {!funnel ? (
        <p className="p-4 text-xs text-neutral-500">Sem dados para este período.</p>
      ) : (
        <div className="space-y-4 p-4">
          <dl className="grid grid-cols-2 gap-2 text-center">
            <Stat label="Iniciados" value={funnel.started} />
            <Stat label="Concluídos" value={funnel.completed} tone="text-emerald-600" />
            <Stat label="Abandonados" value={funnel.abandoned} tone="text-rose-600" />
            <Stat label="Em andamento" value={funnel.inProgress} tone="text-indigo-600" />
            <Stat label="Metas" value={funnel.goals} tone="text-emerald-700" />
            <Stat
              label="Conclusão"
              value={
                funnel.started ? `${Math.round((funnel.completed / funnel.started) * 100)}%` : "–"
              }
            />
          </dl>

          <ol className="space-y-1.5">
            {funnel.nodes.map((n) => {
              const pct = funnel.started ? Math.round((n.reached / funnel.started) * 100) : 0;
              const silent = SILENT.has(n.kind);
              return (
                <li key={n.nodeId} className="text-[11px]">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-neutral-700">
                      {labels[n.nodeId] ?? n.nodeId}
                    </span>
                    <span className="tabular-nums text-neutral-500">
                      {silent ? "–" : `${n.reached} · ${pct}%`}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className={silent ? "h-full bg-neutral-200" : "h-full bg-indigo-400"}
                      style={{ width: `${silent ? 0 : pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>

          <p className="text-[10px] text-neutral-400">
            Blocos que não enviam mensagem (condição, ações, randomizador) não deixam rastro e
            aparecem sem número.
          </p>
        </div>
      )}
    </aside>
  );
}

function Stat({
  label,
  value,
  tone = "text-neutral-800",
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border px-2 py-1.5">
      <dt className="text-[9px] uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteFlow, duplicateFlow, renameFlow, setFlowEnabled } from "./actions";

/**
 * One row in the flow list, with its CRUD affordances.
 *
 * Client component only because renaming happens in place and deleting asks
 * for confirmation. The mutations themselves are server actions submitted by
 * plain forms, so the row keeps working without JavaScript.
 */

export type FlowRowData = {
  id: string;
  name: string;
  enabled: boolean;
  broken: boolean;
  steps: number;
  updatedAt: string;
  triggers: string[];
};

export function FlowRow({ flow }: { flow: FlowRowData }) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded-lg border bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              action={renameFlow}
              onSubmit={() => setRenaming(false)}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="id" value={flow.id} />
              <input
                name="name"
                defaultValue={flow.name}
                autoFocus
                maxLength={120}
                onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
                className="min-w-0 flex-1 rounded border px-2 py-1 text-sm outline-none focus:border-indigo-400 dark:border-neutral-700 dark:bg-neutral-800"
              />
              <button
                type="submit"
                className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white"
              >
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="text-xs text-neutral-500"
              >
                Cancelar
              </button>
            </form>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Link
                  href={`/flows/${flow.id}`}
                  className="truncate font-medium hover:underline"
                >
                  {flow.name}
                </Link>
                <StatusPill enabled={flow.enabled} broken={flow.broken} />
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {flow.steps} {flow.steps === 1 ? "passo" : "passos"}
                {flow.triggers.length > 0 && ` · ${flow.triggers.join(" · ")}`}
              </div>
            </>
          )}
        </div>

        {!renaming && (
          <div className="flex items-center gap-1.5">
            <form action={setFlowEnabled}>
              <input type="hidden" name="id" value={flow.id} />
              <input type="hidden" name="enabled" value={String(!flow.enabled)} />
              <button
                type="submit"
                disabled={!flow.enabled && flow.broken}
                title={
                  !flow.enabled && flow.broken
                    ? "Corrija os erros do fluxo antes de ativar."
                    : undefined
                }
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  flow.enabled
                    ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700"
                }`}
              >
                {flow.enabled ? "Desativar" : "Ativar"}
              </button>
            </form>

            <button
              onClick={() => setRenaming(true)}
              className="rounded-lg border px-2.5 py-1 text-xs text-neutral-600 transition hover:bg-neutral-50 dark:border-neutral-700"
            >
              Renomear
            </button>

            <form action={duplicateFlow}>
              <input type="hidden" name="id" value={flow.id} />
              <button
                type="submit"
                className="rounded-lg border px-2.5 py-1 text-xs text-neutral-600 transition hover:bg-neutral-50 dark:border-neutral-700"
              >
                Duplicar
              </button>
            </form>

            {confirming ? (
              <form action={deleteFlow} className="flex items-center gap-1.5">
                <input type="hidden" name="id" value={flow.id} />
                <span className="text-xs text-rose-600">Excluir?</span>
                <button
                  type="submit"
                  className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white"
                >
                  Sim
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-xs text-neutral-500"
                >
                  Não
                </button>
              </form>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-600 transition hover:bg-rose-50 dark:border-rose-900"
              >
                Excluir
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function StatusPill({ enabled, broken }: { enabled: boolean; broken: boolean }) {
  if (broken) {
    return (
      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/40">
        com erro
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        enabled
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
      }`}
    >
      {enabled ? "ativo" : "pausado"}
    </span>
  );
}

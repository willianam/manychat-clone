"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABEL, MATCH_LABEL } from "../../lib/trigger-rules";
import { TriggerDialog } from "../../components/TriggerDialog";
import { deleteTrigger, setTriggerEnabled, type TriggerView } from "./actions";

export type TriggerRowData = {
  trigger: TriggerView;
  /** Caption of the post this trigger is pinned to, when it is pinned. */
  mediaLabel: string | null;
};

/**
 * The trigger list with its mutations.
 *
 * Client-side because enabling, editing and deleting all happen in place and
 * a full navigation between each would make the list unusable for the one
 * thing it exists for: sweeping through and turning things off.
 *
 * Every mutation ends in `router.refresh()` rather than in local state. The
 * server already recomputes the conflict picture and the "realmente no ar"
 * count, and a second copy of that logic here would be the copy that is wrong.
 */
export function TriggerList({
  rows,
  flows,
}: {
  rows: TriggerRowData[];
  flows: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    { mode: "closed" } | { mode: "new" } | { mode: "edit"; trigger: TriggerView }
  >({ mode: "closed" });

  if (rows.length === 0) {
    return (
      <>
        <div className="mt-8 rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">Nenhum gatilho ainda.</p>
          <p className="mt-1 text-sm text-neutral-500">
            Sem gatilho, nenhum fluxo começa sozinho — nada responde no
            Instagram. Crie o primeiro.
          </p>
          <button
            onClick={() => setDialog({ mode: "new" })}
            disabled={flows.length === 0}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40"
          >
            + Novo gatilho
          </button>
          {flows.length === 0 && (
            <p className="mt-2 text-xs text-neutral-400">
              Crie um fluxo antes — um gatilho precisa de algo para disparar.
            </p>
          )}
        </div>
        {dialog.mode !== "closed" && (
          <TriggerDialog
            flows={flows}
            onClose={() => setDialog({ mode: "closed" })}
            onSaved={() => router.refresh()}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="mt-6 flex justify-end">
        <button
          onClick={() => setDialog({ mode: "new" })}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700"
        >
          + Novo gatilho
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <TriggerRow
            key={row.trigger.id}
            row={row}
            onEdit={() => setDialog({ mode: "edit", trigger: row.trigger })}
          />
        ))}
      </ul>

      {dialog.mode !== "closed" && (
        <TriggerDialog
          flows={flows}
          existing={dialog.mode === "edit" ? dialog.trigger : undefined}
          onClose={() => setDialog({ mode: "closed" })}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}

function TriggerRow({ row, onEdit }: { row: TriggerRowData; onEdit: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = row.trigger;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? "Não foi possível concluir.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{KIND_LABEL[t.kind] ?? t.kind}</span>
            {t.pattern && (
              <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-700">
                {MATCH_LABEL[t.match]}: {t.pattern}
              </code>
            )}
            <StatusPill enabled={t.enabled} flowEnabled={t.flowEnabled} />
          </div>

          <div className="mt-1 text-xs text-neutral-500">
            roda{" "}
            <Link href={`/flows/${t.flowId}`} className="text-indigo-600 hover:underline">
              {t.flowName}
            </Link>
            {t.kind === "COMMENT" && (
              <>
                {" · "}
                {t.mediaId
                  ? `só em: ${row.mediaLabel ?? `publicação ${t.mediaId}`}`
                  : "qualquer publicação"}
              </>
            )}
            {t.priority > 0 && ` · prioridade ${t.priority}`}
          </div>

          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            disabled={pending}
            onClick={() => run(() => setTriggerEnabled(t.id, !t.enabled))}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 ${
              t.enabled
                ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {t.enabled ? "Desativar" : "Ativar"}
          </button>

          <button
            onClick={onEdit}
            className="rounded-lg border px-2.5 py-1 text-xs text-neutral-600 transition hover:bg-neutral-50"
          >
            Editar
          </button>

          {confirming ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-rose-600">Excluir?</span>
              <button
                disabled={pending}
                onClick={() => run(() => deleteTrigger(t.id))}
                className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                Sim
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-xs text-neutral-500"
              >
                Não
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs text-rose-600 transition hover:bg-rose-50"
            >
              Excluir
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * A trigger that is on but whose flow is paused is the failure this pill
 * exists for: it looks live in every other view and answers nothing.
 */
function StatusPill({ enabled, flowEnabled }: { enabled: boolean; flowEnabled: boolean }) {
  if (!enabled) {
    return (
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">
        desativado
      </span>
    );
  }
  if (!flowEnabled) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        fluxo pausado
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
      no ar
    </span>
  );
}

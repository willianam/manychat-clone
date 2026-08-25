import { db } from "../../server/db";
import { createTriggerFromUnmatched, dismissUnmatched, restoreUnmatched } from "./actions";

export const dynamic = "force-dynamic";

/**
 * "Digitaram e não casou".
 *
 * Every inbound message that fired no trigger lands here, aggregated by its
 * normalized form — so the list is ranked by how many real people asked,
 * not by how many rows we happened to write. The whole screen is pointed at
 * one decision: is this phrase worth a keyword?
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ mostrar?: string }>;
}) {
  const { mostrar } = await searchParams;
  const showResolved = mostrar === "resolvidas";

  const [rows, flows, pendingCount] = await Promise.all([
    db.unmatchedMessage.findMany({
      where: showResolved ? { resolvedAt: { not: null } } : { resolvedAt: null },
      orderBy: [{ count: "desc" }, { lastSeenAt: "desc" }],
      take: 100,
    }),
    db.flow.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.unmatchedMessage.count({ where: { resolvedAt: null } }),
  ]);

  const totalMisses = rows.reduce((n, r) => n + r.count, 0);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">O que digitaram e não casou</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Mensagens que não bateram com nenhum gatilho, agrupadas por texto. Uma linha pode
        representar muita gente — use a contagem para decidir o que vira palavra-chave.
      </p>

      <div className="mt-4 flex items-center gap-4 text-sm">
        <a
          href="/insights"
          className={showResolved ? "text-neutral-600 hover:text-neutral-900" : "font-medium"}
        >
          Pendentes ({pendingCount})
        </a>
        <a
          href="/insights?mostrar=resolvidas"
          className={showResolved ? "font-medium" : "text-neutral-600 hover:text-neutral-900"}
        >
          Já resolvidas
        </a>
        {!showResolved && totalMisses > 0 && (
          <span className="ml-auto text-neutral-500">
            {totalMisses} mensagem{totalMisses === 1 ? "" : "s"} sem resposta automática
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed bg-white p-8 text-center text-sm text-neutral-500">
          {showResolved
            ? "Nada resolvido ainda."
            : "Nenhuma mensagem sem gatilho por enquanto. Quando alguém escrever algo que os seus gatilhos não cobrem, aparece aqui."}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border bg-white p-4">
            <div className="flex items-start gap-3">
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${
                  r.count >= 10 ? "bg-amber-100 text-amber-900" : "bg-neutral-100 text-neutral-700"
                }`}
                title={`${r.count} pessoa(s) escreveram algo equivalente`}
              >
                {r.count}×
              </span>

              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.sample}</div>
                {r.normalized !== r.sample.toLowerCase() && (
                  <div className="truncate text-xs text-neutral-500">
                    agrupado como “{r.normalized}”
                  </div>
                )}
                <div className="mt-1 text-xs text-neutral-500">
                  primeira vez {fmt(r.firstSeenAt)} · última vez {fmt(r.lastSeenAt)}
                </div>
              </div>
            </div>

            {showResolved ? (
              <form action={restoreUnmatched} className="mt-3">
                <input type="hidden" name="id" value={r.id} />
                <button className="text-sm text-neutral-600 underline hover:text-neutral-900">
                  Voltar para pendentes
                </button>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={createTriggerFromUnmatched} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <select
                    name="flowId"
                    required
                    defaultValue=""
                    className="rounded border px-2 py-1.5 text-sm"
                  >
                    <option value="" disabled>
                      escolha o fluxo…
                    </option>
                    {flows.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={flows.length === 0}
                    className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                  >
                    Criar gatilho com isso
                  </button>
                </form>

                <form action={dismissUnmatched}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="rounded border px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
                    Ignorar
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>

      {flows.length === 0 && rows.length > 0 && (
        <p className="mt-4 text-sm text-amber-800">
          Crie um fluxo antes para poder apontar um gatilho para ele.
        </p>
      )}
    </main>
  );
}

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

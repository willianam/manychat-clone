import { db } from "../../server/db";
import { listCustomFields } from "../../server/custom-fields";
import { fieldKeysInGraph } from "../../lib/field-usage";
import { createField, renameField, deleteField } from "./actions";

export const dynamic = "force-dynamic";

const TYPE_LABEL = { TEXT: "texto", NUMBER: "número", DATE: "data", BOOLEAN: "sim/não" } as const;

/**
 * Custom field registry. Minimal on purpose (the real UI is a later wave):
 * list, create, rename the label, delete when no flow writes the key.
 */
export default async function CamposPage() {
  const [fields, flows] = await Promise.all([
    listCustomFields(db),
    db.flow.findMany({ select: { name: true, graph: true } }),
  ]);

  const usedBy = new Map<string, string[]>();
  for (const f of flows) {
    for (const key of fieldKeysInGraph(f.graph)) {
      usedBy.set(key, [...(usedBy.get(key) ?? []), f.name]);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Campos</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Campos guardam o que os contatos respondem. Um fluxo que salva um campo novo o registra aqui
        sozinho; o tipo decide como condições e segmentos comparam o valor.
      </p>

      <form
        action={createField}
        className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border bg-white p-4"
      >
        <div>
          <label className="block text-xs text-neutral-500">Chave</label>
          <input
            name="key"
            required
            maxLength={60}
            pattern="[a-zA-Z_][a-zA-Z0-9_]*"
            placeholder="ex: cidade"
            className="mt-1 rounded border px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Nome</label>
          <input
            name="label"
            maxLength={80}
            placeholder="ex: Cidade"
            className="mt-1 rounded border px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Tipo</label>
          <select
            name="type"
            defaultValue="text"
            className="mt-1 rounded border px-2 py-1.5 text-sm"
          >
            <option value="text">texto</option>
            <option value="number">número</option>
            <option value="date">data</option>
            <option value="boolean">sim/não</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Valor padrão</label>
          <input
            name="defaultValue"
            maxLength={200}
            className="mt-1 rounded border px-2 py-1.5 text-sm"
          />
        </div>
        <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">Criar</button>
      </form>

      {fields.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed bg-white p-8 text-center text-sm text-neutral-500">
          Nenhum campo ainda.
        </div>
      )}

      <div className="mt-4 space-y-2">
        {fields.map((f) => {
          const inFlows = usedBy.get(f.key) ?? [];
          return (
            <div key={f.id} className="rounded-lg border bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <code className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{f.key}</code>
                <span className="text-sm">{f.label}</span>
                <span className="text-xs text-neutral-500">{TYPE_LABEL[f.type]}</span>
                {f.defaultValue && (
                  <span className="text-xs text-neutral-500">padrão: {f.defaultValue}</span>
                )}
                {inFlows.length > 0 && (
                  <span className="text-xs text-amber-800" title={inFlows.join(", ")}>
                    usado por {inFlows.length} fluxo{inFlows.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={renameField} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={f.id} />
                  <input
                    name="label"
                    defaultValue={f.label}
                    maxLength={80}
                    className="rounded border px-2 py-1 text-sm"
                  />
                  <button className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">
                    Renomear
                  </button>
                </form>

                <form action={deleteField}>
                  <input type="hidden" name="id" value={f.id} />
                  <button
                    disabled={inFlows.length > 0}
                    title={inFlows.length > 0 ? "Em uso por um fluxo" : undefined}
                    className="rounded border px-3 py-1 text-sm text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Excluir
                  </button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

import { db } from "../../server/db";
import { createTag, renameTag, deleteTag, mergeTags } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Tag management.
 *
 * The contact count is the point of the screen: a tag with zero contacts is
 * usually a typo of one that has hundreds, which is what "mesclar" is for.
 */
export default async function TagsPage() {
  const tags = await db.tag.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { contacts: true } } },
  });

  // Which tags a flow graph mentions by name — shown as a warning next to
  // delete, since nothing at the database level protects that reference.
  const flows = await db.flow.findMany({ select: { id: true, name: true, graph: true } });
  const usedNames = new Map<string, string[]>();
  for (const t of tags) {
    const needle = JSON.stringify(t.name);
    const hits = flows.filter((f) => JSON.stringify(f.graph).includes(needle)).map((f) => f.name);
    if (hits.length) usedNames.set(t.id, hits);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Etiquetas</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Etiquetas marcam contatos e são usadas por fluxos e disparos. Renomear atualiza
        os fluxos que citam a etiqueta; excluir avisa antes se ela estiver em uso.
      </p>

      <form
        action={createTag}
        className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border bg-white p-4"
      >
        <div>
          <label className="block text-xs text-neutral-500">Nova etiqueta</label>
          <input
            name="name"
            required
            maxLength={60}
            placeholder="ex: lead-quente"
            className="mt-1 rounded border px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-neutral-500">Cor</label>
          <input
            name="color"
            type="color"
            defaultValue="#6366f1"
            className="mt-1 h-9 w-14 rounded border"
          />
        </div>
        <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
          Criar
        </button>
      </form>

      {tags.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed bg-white p-8 text-center text-sm text-neutral-500">
          Nenhuma etiqueta ainda.
        </div>
      )}

      <div className="mt-4 space-y-2">
        {tags.map((t) => {
          const inFlows = usedNames.get(t.id) ?? [];
          return (
            <div key={t.id} className="rounded-lg border bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs text-white"
                  style={{ backgroundColor: t.color }}
                >
                  {t.name}
                </span>
                <span className="text-sm tabular-nums text-neutral-600">
                  {t._count.contacts} contato{t._count.contacts === 1 ? "" : "s"}
                </span>
                {inFlows.length > 0 && (
                  <span
                    className="text-xs text-amber-800"
                    title={inFlows.join(", ")}
                  >
                    usada por {inFlows.length} fluxo{inFlows.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={renameTag} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input
                    name="name"
                    defaultValue={t.name}
                    maxLength={60}
                    className="rounded border px-2 py-1 text-sm"
                  />
                  <button className="rounded border px-3 py-1 text-sm hover:bg-neutral-50">
                    Renomear
                  </button>
                </form>

                <form action={deleteTag} className="flex items-center gap-1">
                  <input type="hidden" name="id" value={t.id} />
                  <button
                    name="confirm"
                    value="false"
                    className="rounded border px-3 py-1 text-sm text-rose-700 hover:bg-rose-50"
                  >
                    Excluir
                  </button>
                  {inFlows.length > 0 && (
                    <button
                      name="confirm"
                      value="true"
                      className="rounded border border-rose-300 px-3 py-1 text-xs text-rose-700 hover:bg-rose-50"
                      title="Exclui mesmo estando em uso por um fluxo"
                    >
                      excluir mesmo assim
                    </button>
                  )}
                </form>
              </div>
            </div>
          );
        })}
      </div>

      {tags.length >= 2 && (
        <form
          action={mergeTags}
          className="mt-6 flex flex-wrap items-end gap-2 rounded-lg border bg-white p-4"
        >
          <div>
            <label className="block text-xs text-neutral-500">Mesclar esta…</label>
            <select name="sourceId" required defaultValue="" className="mt-1 rounded border px-2 py-1.5 text-sm">
              <option value="" disabled>
                escolha…
              </option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t._count.contacts})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-500">…dentro desta</label>
            <select name="targetId" required defaultValue="" className="mt-1 rounded border px-2 py-1.5 text-sm">
              <option value="" disabled>
                escolha…
              </option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t._count.contacts})
                </option>
              ))}
            </select>
          </div>
          <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
            Mesclar
          </button>
          <p className="w-full text-xs text-neutral-500">
            Os contatos da primeira passam a ter a segunda, os fluxos e disparos são
            atualizados, e a primeira é excluída.
          </p>
        </form>
      )}
    </main>
  );
}

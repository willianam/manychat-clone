import { db } from "../../server/db";
import { refLinkUrl } from "../../lib/entry-events";
import { CopyLink } from "./CopyLink";
import { createRefLink, setRefLinkEnabled, deleteRefLink } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The IG handle the links point at. Without it we cannot build a usable url,
 * so the page says so rather than printing a broken link.
 */
const USERNAME = process.env.IG_USERNAME ?? "";

export default async function RefLinksPage() {
  const [links, flows] = await Promise.all([
    db.refLink.findMany({ include: { flow: true }, orderBy: { createdAt: "desc" } }),
    db.flow.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Links rastreáveis</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          Um link <code className="font-mono text-xs">ig.me</code> que abre a DM já disparando
          um fluxo. Use um por canal para saber de onde vem cada contato.
        </p>
      </div>

      {!USERNAME && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Defina <code className="font-mono text-xs">IG_USERNAME</code> nas variáveis de ambiente
          para gerar os links completos.
        </p>
      )}

      {flows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-neutral-500">
          Crie um fluxo antes de criar um link.
        </p>
      ) : (
        <form
          action={createRefLink}
          className="mt-6 flex flex-wrap items-end gap-2 rounded-xl border bg-white p-4"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Nome</span>
            <input
              name="label"
              required
              maxLength={120}
              placeholder="Bio do Instagram"
              className="w-48 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Fluxo</span>
            <select
              name="flowId"
              required
              className="w-52 rounded-lg border bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
            >
              {flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.enabled ? "" : " (desativado)"}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-neutral-600">Código (opcional)</span>
            <input
              name="code"
              maxLength={250}
              placeholder="gerado automaticamente"
              className="w-52 rounded-lg border px-3 py-1.5 font-mono text-sm outline-none focus:border-indigo-400"
            />
          </label>

          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            + Criar link
          </button>
        </form>
      )}

      <ul className="mt-6 space-y-3">
        {links.map((link) => (
          <li key={link.id} className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {link.label}
                  {!link.enabled && (
                    <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-normal text-neutral-500">
                      pausado
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-neutral-500">
                  Dispara <span className="text-neutral-700">{link.flow.name}</span>
                  {!link.flow.enabled && (
                    <span className="text-amber-700"> — fluxo desativado, nada será enviado</span>
                  )}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-4">
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums">
                    {link.clicks} {link.clicks === 1 ? "clique" : "cliques"}
                  </p>
                  <p className="text-xs text-neutral-500 tabular-nums">
                    {link.conversions} no fluxo
                  </p>
                </div>

                <form action={setRefLinkEnabled}>
                  <input type="hidden" name="id" value={link.id} />
                  <input type="hidden" name="enabled" value={String(!link.enabled)} />
                  <button
                    type="submit"
                    className="rounded-lg border px-2.5 py-1 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50"
                  >
                    {link.enabled ? "Pausar" : "Ativar"}
                  </button>
                </form>

                <form action={deleteRefLink}>
                  <input type="hidden" name="id" value={link.id} />
                  <button
                    type="submit"
                    className="rounded-lg border px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                  >
                    Excluir
                  </button>
                </form>
              </div>
            </div>

            {USERNAME && (
              <div className="mt-3">
                <CopyLink url={refLinkUrl(USERNAME, link.code)} />
              </div>
            )}
          </li>
        ))}
      </ul>

      {links.length === 0 && (
        <p className="mt-6 text-center text-sm text-neutral-500">Nenhum link criado ainda.</p>
      )}
    </main>
  );
}

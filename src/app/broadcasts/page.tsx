import { db } from "../../server/db";
import { previewAudience } from "../../server/broadcast-worker";
import { createBroadcast, queueBroadcast, deleteBroadcast } from "./actions";
import { AudiencePicker } from "./AudiencePicker";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const [tags, broadcasts] = await Promise.all([
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    db.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { _count: { select: { recipients: true } } },
    }),
  ]);

  // Per-draft window snapshots, resolved up front rather than inside the JSX
  // map: an async callback there returns Promises to React instead of nodes.
  const previews = new Map(
    await Promise.all(
      broadcasts
        .filter((b) => b.status === "DRAFT")
        .map(
          async (b) =>
            [b.id, await previewAudience(db, { tagIds: b.filterTagIds })] as const,
        ),
    ),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Disparos</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Uma mensagem para muitos contatos. Só chega em quem escreveu nas últimas 24 horas
        — por isso o número aparece antes de você disparar, e não só no relatório.
      </p>

      <form action={createBroadcast} className="mt-6 space-y-4 rounded-lg border bg-white p-4">
        <div>
          <label className="block text-xs text-neutral-500">Nome interno</label>
          <input
            name="name"
            maxLength={120}
            placeholder="ex: promoção de sexta"
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-neutral-500">Mensagem</label>
          <textarea
            name="text"
            required
            rows={4}
            maxLength={1000}
            className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
          />
        </div>

        <AudiencePicker tags={tags} />

        <button className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white">
          Salvar rascunho
        </button>
      </form>

      <div className="mt-6 space-y-2">
        {broadcasts.map((b) => {
          // The window keeps closing, so a draft saved yesterday reaches
          // fewer people than it would have then.
          const p = previews.get(b.id) ?? null;

          return (
            <div key={b.id} className="rounded-lg border bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{b.name}</span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700">
                  {b.status}
                </span>
                {b._count.recipients > 0 && (
                  <span className="text-xs text-neutral-500">
                    {b._count.recipients} destinatário(s)
                  </span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">{b.text}</p>

              {p && (
                <div
                  className={`mt-2 text-xs ${p.mostlyOutOfWindow ? "text-amber-800" : "text-neutral-600"}`}
                >
                  {p.inWindow} de {p.total} contatos estão dentro da janela agora
                  {p.mostlyOutOfWindow && " — a maioria não vai receber"}
                </div>
              )}

              {b.status === "DRAFT" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={queueBroadcast} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={b.id} />
                    <select name="window" defaultValue="in" className="rounded border px-2 py-1 text-sm">
                      <option value="in">Só quem está dentro da janela</option>
                      <option value="">Todos (fora da janela vai falhar)</option>
                    </select>
                    <button className="rounded bg-neutral-900 px-3 py-1 text-sm text-white">
                      Enfileirar
                    </button>
                  </form>
                  <form action={deleteBroadcast}>
                    <input type="hidden" name="id" value={b.id} />
                    <button className="rounded border px-3 py-1 text-sm text-rose-700 hover:bg-rose-50">
                      Excluir
                    </button>
                  </form>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}

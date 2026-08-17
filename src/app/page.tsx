import Link from "next/link";
import { db } from "../server/db";
import { canSend, windowRemainingMs } from "../lib/messaging-window";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [contacts, flows, tags] = await Promise.all([
    db.contact.findMany({ orderBy: { createdAt: "asc" } }),
    db.flow.findMany({ include: { triggers: true } }),
    db.tag.findMany(),
  ]);

  const reachable = contacts.filter((c) => canSend(c.lastInboundAt).allowed).length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Painel</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Conectado ao Postgres de produção. O envio de mensagens depende das
        credenciais da Meta.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Contatos" value={contacts.length} />
        <Stat label="Alcançáveis agora" value={reachable} hint="dentro da janela de 24h" />
        <Stat label="Fluxos" value={flows.length} />
        <Stat label="Tags" value={tags.length} />
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Fluxos</h2>
        <ul className="mt-3 space-y-2">
          {flows.map((f) => {
            const graph = f.graph as unknown as { nodes: unknown[] };
            return (
              <li key={f.id} className="rounded-lg border bg-white p-4">
                <div className="flex items-center gap-3">
                  <Link href={`/flows/${f.id}`} className="font-medium hover:underline">
                    {f.name}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      f.enabled ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {f.enabled ? "ativo" : "inativo"}
                  </span>
                  <span className="text-xs text-neutral-500">{graph.nodes.length} nós</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.triggers.map((t) => (
                    <code key={t.id} className="rounded bg-neutral-100 px-2 py-0.5 text-xs">
                      {t.kind.toLowerCase()}: &quot;{t.pattern}&quot;
                    </code>
                  ))}
                </div>
                <Link
                  href={`/flows/${f.id}`}
                  className="mt-3 inline-block rounded bg-indigo-600 px-3 py-1.5 text-sm text-white"
                >
                  Abrir editor visual →
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Contatos e a janela de 24h</h2>
        <p className="mt-1 text-sm text-neutral-600">
          A regra da Meta que o sistema aplica antes de qualquer envio.
        </p>
        <table className="mt-3 w-full overflow-hidden rounded-lg border bg-white text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Contato</th>
              <th className="px-4 py-2">Última mensagem</th>
              <th className="px-4 py-2">Pode receber?</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => {
              const d = canSend(c.lastInboundAt);
              const left = windowRemainingMs(c.lastInboundAt);
              return (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2">
                    <div className="font-medium">{c.name ?? "—"}</div>
                    <div className="text-xs text-neutral-500">@{c.username ?? "sem-user"}</div>
                  </td>
                  <td className="px-4 py-2 text-neutral-600">
                    {c.lastInboundAt
                      ? `há ${Math.round((Date.now() - c.lastInboundAt.getTime()) / 3_600_000)}h`
                      : "nunca escreveu"}
                  </td>
                  <td className="px-4 py-2">
                    {d.allowed ? (
                      <span className="text-emerald-700">
                        ✓ sim · restam {Math.round(left / 3_600_000)}h
                      </span>
                    ) : (
                      <span className="text-rose-700">✗ {d.reason}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-neutral-600">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-400">{hint}</div>}
    </div>
  );
}

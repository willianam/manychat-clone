import Link from "next/link";
import { db } from "../../../../server/db";
import { FlowGraph } from "../../../../lib/flow-schema";
import { PreviewPhone } from "./PreviewPhone";

export const dynamic = "force-dynamic";

/**
 * Conversation preview.
 *
 * Reads the saved graph and hands it to a client component that walks it.
 * Nothing on this route can send: no API client is imported, and the only
 * server work is one read.
 */
export default async function FlowPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const flow = await db.flow.findUnique({ where: { id } });
  if (!flow) return <main className="p-8">Fluxo não encontrado.</main>;

  const parsed = FlowGraph.safeParse(flow.graph);
  if (!parsed.success) {
    return (
      <main className="p-8">
        <p className="text-sm text-rose-600">
          Este fluxo não pode ser lido — o formato salvo é inválido.
        </p>
        <Link href={`/flows/${id}`} className="mt-2 inline-block text-xs underline">
          ← Voltar ao editor
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <Link href={`/flows/${id}`} className="text-xs text-neutral-500 hover:underline">
          ← Voltar ao editor
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Prévia: {flow.name}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          O fluxo como a conversa vai aparecer no celular. Toque nos botões para
          seguir cada caminho. Nada é enviado — serve para revisar o texto sem
          mandar DM de verdade.
        </p>
      </div>

      <PreviewPhone graph={parsed.data} name={flow.name} />
    </main>
  );
}

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "../../../server/db";
import { FlowGraph } from "../../../lib/flow-schema";
import { accountTimeZone } from "../../../lib/timezone";
import { Composer } from "../Composer";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function NewBroadcastPage() {
  const [tags, segments, flows] = await Promise.all([
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    db.segment.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.flow.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, graph: true },
    }),
  ]);

  // The preview walks the graph on the client; a graph that fails the
  // schema is passed as null so the composer says so instead of crashing.
  const previewable = flows.map((f) => ({
    id: f.id,
    name: f.name,
    graph: FlowGraph.safeParse(f.graph).data ?? null,
  }));

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageHeader
        title="Novo disparo"
        description="Uma mensagem para muitos contatos. Só chega em quem escreveu nas últimas 24 horas, por isso o número aparece antes de você disparar."
        actions={
          <Button asChild variant="outline">
            <Link href="/broadcasts">
              <ArrowLeft aria-hidden />
              Voltar
            </Link>
          </Button>
        }
      />
      <Composer tags={tags} segments={segments} flows={previewable} timeZone={accountTimeZone()} />
    </main>
  );
}

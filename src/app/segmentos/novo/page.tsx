import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "../../../server/db";
import { listCustomFields } from "../../../server/custom-fields";
import { SegmentBuilder } from "../SegmentBuilder";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function NovoSegmentoPage() {
  const [tags, fields] = await Promise.all([
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listCustomFields(db),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href="/segmentos">
          <ArrowLeft aria-hidden />
          Segmentos
        </Link>
      </Button>
      <PageHeader
        title="Novo segmento"
        description="A contagem atualiza conforme você monta as regras."
      />
      <div className="mt-6">
        <SegmentBuilder
          ctx={{ tags, fields: fields.map((f) => ({ key: f.key, label: f.label })) }}
        />
      </div>
    </main>
  );
}

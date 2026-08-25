import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "../../../server/db";
import { listCustomFields } from "../../../server/custom-fields";
import { parseSegmentRules } from "../../../server/segments";
import { EMPTY_RULES } from "../../../lib/segment-rules";
import { SegmentBuilder } from "../SegmentBuilder";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function EditarSegmentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [segment, tags, fields] = await Promise.all([
    db.segment.findUnique({ where: { id } }),
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listCustomFields(db),
  ]);
  if (!segment) notFound();

  let rules = EMPTY_RULES;
  let broken = false;
  try {
    rules = parseSegmentRules(segment.rules);
  } catch {
    broken = true;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href="/segmentos">
          <ArrowLeft aria-hidden />
          Segmentos
        </Link>
      </Button>
      <PageHeader
        title={segment.name}
        description="Editar regras. Disparos que usam este segmento passam a usar as regras novas."
      />
      {broken && (
        <Callout tone="warning" className="mt-4">
          As regras salvas não puderam ser lidas; o editor abriu vazio. Salvar substitui o que
          havia.
        </Callout>
      )}
      <div className="mt-6">
        <SegmentBuilder
          segment={{ id: segment.id, name: segment.name, rules }}
          ctx={{ tags, fields: fields.map((f) => ({ key: f.key, label: f.label })) }}
        />
      </div>
    </main>
  );
}

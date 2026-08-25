import Link from "next/link";
import { Filter, Plus } from "lucide-react";
import { db } from "../../server/db";
import { listSegments, parseSegmentRules } from "../../server/segments";
import { listCustomFields } from "../../server/custom-fields";
import { describeRules } from "../../lib/segment-builder";
import { SegmentRow, type SegmentRowData } from "./SegmentRow";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function SegmentosPage() {
  const [segments, tags, fields, broadcasts] = await Promise.all([
    listSegments(db),
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listCustomFields(db),
    db.broadcast.findMany({
      where: { segmentId: { not: null } },
      select: { id: true, name: true, segmentId: true },
    }),
  ]);
  const ctx = { tags, fields: fields.map((f) => ({ key: f.key, label: f.label })) };

  const rows: SegmentRowData[] = segments.map((s) => {
    let summary = "regras inválidas";
    let ruleCount = 0;
    try {
      const rules = parseSegmentRules(s.rules);
      summary = describeRules(rules, ctx);
      ruleCount = rules.rules.length;
    } catch {
      // A segment saved by an older build may not parse; it is still listed so it can be fixed.
    }
    return {
      id: s.id,
      name: s.name,
      summary,
      ruleCount,
      broadcasts: broadcasts
        .filter((b) => b.segmentId === s.id)
        .map((b) => ({ id: b.id, name: b.name })),
    };
  });

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Segmentos"
        description="Audiências salvas por regra: etiquetas, campos, origem, janela de 24h. Um disparo escolhe um segmento em vez de marcar etiquetas uma a uma."
        actions={
          <Button asChild>
            <Link href="/segmentos/novo">
              <Plus aria-hidden />
              Novo segmento
            </Link>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Filter}
          title="Nenhum segmento ainda."
          description="Crie o primeiro e veja quantos contatos ele alcança enquanto monta as regras."
          action={
            <Button asChild variant="outline">
              <Link href="/segmentos/novo">Criar segmento</Link>
            </Button>
          }
        />
      ) : (
        <ul className="mt-6 space-y-2">
          {rows.map((s) => (
            <SegmentRow key={s.id} segment={s} />
          ))}
        </ul>
      )}
    </main>
  );
}

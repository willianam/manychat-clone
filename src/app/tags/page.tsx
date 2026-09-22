import Link from "next/link";
import { Tag, Users } from "lucide-react";
import { db } from "../../server/db";
import { formError } from "../../lib/ui/form-error";
import { createTag, renameTag, deleteTag, mergeTags } from "./actions";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { TagChip } from "@/components/ui/tag-chip";

export const dynamic = "force-dynamic";

/**
 * Tag management.
 *
 * The contact count is the point of the screen: a tag with zero contacts is
 * usually a typo of one that has hundreds, which is what "mesclar" is for.
 */
export default async function TagsPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const erro = formError((await searchParams).erro);
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
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Etiquetas"
        description="Etiquetas marcam contatos e são usadas por fluxos e disparos. Renomear atualiza os fluxos que citam a etiqueta; excluir avisa antes se ela estiver em uso."
      />

      {erro && (
        <Callout tone="destructive" className="mt-6">
          {erro}
        </Callout>
      )}

      <Card className="mt-6">
        <CardContent className="p-4">
          <form action={createTag} className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1 space-y-1.5">
              <Label htmlFor="tag-name">Nova etiqueta</Label>
              <Input
                id="tag-name"
                name="name"
                required
                maxLength={60}
                placeholder="ex: lead-quente"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tag-color">Cor</Label>
              <Input
                id="tag-color"
                name="color"
                type="color"
                defaultValue="#6366f1"
                className="h-9 w-14 cursor-pointer p-1"
              />
            </div>
            <SubmitButton pendingLabel="Criando…">Criar</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {tags.length === 0 && (
        <EmptyState
          className="mt-6"
          icon={Tag}
          title="Nenhuma etiqueta ainda."
          description="Crie a primeira acima. Fluxos podem marcar contatos com ela e disparos podem filtrar por ela."
        />
      )}

      <div className="mt-4 space-y-2">
        {tags.map((t) => {
          const inFlows = usedNames.get(t.id) ?? [];
          const inUse = inFlows.length > 0;
          return (
            <Card key={t.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <TagChip name={t.name} color={t.color} />
                  <Button asChild variant="link" size="sm" className="h-auto p-0 tabular-nums">
                    <Link href={`/contacts?tag=${t.id}`}>
                      <Users aria-hidden />
                      {t._count.contacts} contato{t._count.contacts === 1 ? "" : "s"}
                    </Link>
                  </Button>
                  {inUse && (
                    <span className="text-xs text-amber-800" title={inFlows.join(", ")}>
                      usada por {inFlows.length} fluxo{inFlows.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={renameTag} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={t.id} />
                    <Label htmlFor={`rename-${t.id}`} className="sr-only">
                      Novo nome para {t.name}
                    </Label>
                    <Input
                      id={`rename-${t.id}`}
                      name="name"
                      defaultValue={t.name}
                      maxLength={60}
                      className="h-8 w-48"
                    />
                    <Label htmlFor={`color-${t.id}`} className="sr-only">
                      Cor de {t.name}
                    </Label>
                    <Input
                      id={`color-${t.id}`}
                      name="color"
                      type="color"
                      defaultValue={t.color}
                      className="h-8 w-12 cursor-pointer p-1"
                    />
                    <SubmitButton variant="outline" size="sm" pendingLabel="Salvando…">
                      Salvar
                    </SubmitButton>
                  </form>

                  <form action={deleteTag} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={t.id} />
                    <ConfirmSubmitButton
                      name="confirm"
                      value="false"
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-rose-50 hover:text-destructive"
                      title={`Excluir a etiqueta "${t.name}"?`}
                      description={
                        inUse
                          ? 'Ela ainda é usada por fluxos; a exclusão será recusada até você confirmar em "excluir mesmo assim".'
                          : `Os ${t._count.contacts} contato(s) perdem a marcação. Isso não pode ser desfeito.`
                      }
                    >
                      Excluir
                    </ConfirmSubmitButton>
                    {inUse && (
                      <ConfirmSubmitButton
                        name="confirm"
                        value="true"
                        variant="destructive"
                        size="sm"
                        title={`Excluir "${t.name}" mesmo em uso?`}
                        description={`Fluxos que citam esta etiqueta (${inFlows.join(", ")}) passam a apontar para algo que não existe. Isso não pode ser desfeito.`}
                        confirmLabel="Excluir mesmo assim"
                      >
                        excluir mesmo assim
                      </ConfirmSubmitButton>
                    )}
                  </form>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {tags.length >= 2 && (
        <Card className="mt-6">
          <CardContent className="p-4">
            <form action={mergeTags} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="merge-source">Mesclar esta…</Label>
                <Select name="sourceId" required>
                  <SelectTrigger id="merge-source" className="w-56">
                    <SelectValue placeholder="escolha…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tags.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t._count.contacts})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="merge-target">…dentro desta</Label>
                <Select name="targetId" required>
                  <SelectTrigger id="merge-target" className="w-56">
                    <SelectValue placeholder="escolha…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tags.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} ({t._count.contacts})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <ConfirmSubmitButton
                variant="secondary"
                title="Mesclar as duas etiquetas?"
                description="Os contatos da primeira passam a ter a segunda, fluxos e disparos passam a citar a segunda, e a primeira é excluída. Isso não pode ser desfeito."
                confirmLabel="Mesclar"
              >
                Mesclar
              </ConfirmSubmitButton>
              <p className="w-full text-xs text-muted-foreground">
                Os contatos da primeira passam a ter a segunda, os fluxos e disparos são
                atualizados, e a primeira é excluída.
              </p>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

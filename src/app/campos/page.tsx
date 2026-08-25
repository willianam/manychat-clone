import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { db } from "../../server/db";
import { contactCountsByField, listCustomFields } from "../../server/custom-fields";
import { fieldKeysInGraph } from "../../lib/field-usage";
import { createField, updateField, deleteField } from "./actions";
import { TypeSelect } from "./TypeSelect";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

const FIELD_TYPE_LABEL = {
  TEXT: "texto",
  NUMBER: "número",
  DATE: "data",
  BOOLEAN: "sim/não",
} as const;

/**
 * Custom field registry: create, edit label/type/default, see which flows
 * write the key and how many contacts hold a value, delete when nothing
 * writes it. The key itself is immutable — flows reference it by name.
 */
export default async function CamposPage() {
  const [fields, flows, counts] = await Promise.all([
    listCustomFields(db),
    db.flow.findMany({ select: { id: true, name: true, graph: true } }),
    contactCountsByField(db),
  ]);

  const usedBy = new Map<string, Array<{ id: string; name: string }>>();
  for (const f of flows) {
    for (const key of fieldKeysInGraph(f.graph)) {
      usedBy.set(key, [...(usedBy.get(key) ?? []), { id: f.id, name: f.name }]);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Campos"
        description="Campos guardam o que os contatos respondem. Um fluxo que salva um campo novo o registra aqui sozinho; o tipo decide como condições e segmentos comparam o valor."
      />

      <Card className="mt-6">
        <CardContent className="p-4">
          <form action={createField} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-key">Chave</Label>
              <Input
                id="new-key"
                name="key"
                required
                maxLength={60}
                pattern="[a-zA-Z_][a-zA-Z0-9_]*"
                title="Letras, números e _; começa com letra ou _"
                placeholder="ex: cidade"
                className="w-40"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-label">Nome</Label>
              <Input
                id="new-label"
                name="label"
                maxLength={80}
                placeholder="ex: Cidade"
                className="w-44"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-type">Tipo</Label>
              <TypeSelect id="new-type" name="type" defaultValue="text" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-default">Valor padrão</Label>
              <Input id="new-default" name="defaultValue" maxLength={200} className="w-40" />
            </div>
            <SubmitButton pendingLabel="Criando…">Criar campo</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {fields.length === 0 && (
        <EmptyState
          className="mt-6"
          icon={SlidersHorizontal}
          title="Nenhum campo ainda."
          description="Crie o primeiro acima, ou deixe um fluxo salvar uma resposta: a chave aparece aqui sozinha."
        />
      )}

      <div className="mt-4 space-y-2">
        {fields.map((f) => {
          const inFlows = usedBy.get(f.key) ?? [];
          const inUse = inFlows.length > 0;
          const contacts = counts.get(f.key) ?? 0;
          return (
            <Card key={f.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <code className="rounded bg-muted px-2 py-0.5 text-xs">{f.key}</code>
                  <StatusPill tone="info">{FIELD_TYPE_LABEL[f.type]}</StatusPill>
                  <span className="text-sm tabular-nums text-neutral-600">
                    {contacts} contato{contacts === 1 ? "" : "s"} com valor
                  </span>
                  {inUse && (
                    <span className="text-xs text-amber-800">
                      usado por{" "}
                      {inFlows.map((fl, i) => (
                        <span key={fl.id}>
                          {i > 0 && ", "}
                          <Link href={`/flows/${fl.id}`} className="underline">
                            {fl.name}
                          </Link>
                        </span>
                      ))}
                    </span>
                  )}
                </div>

                <form action={updateField} className="mt-3 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="id" value={f.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor={`label-${f.id}`}>Nome</Label>
                    <Input
                      id={`label-${f.id}`}
                      name="label"
                      defaultValue={f.label}
                      maxLength={80}
                      className="h-8 w-44"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`type-${f.id}`}>Tipo</Label>
                    <TypeSelect
                      id={`type-${f.id}`}
                      name="type"
                      defaultValue={f.type.toLowerCase()}
                      className="h-8"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`default-${f.id}`}>Valor padrão</Label>
                    <Input
                      id={`default-${f.id}`}
                      name="defaultValue"
                      defaultValue={f.defaultValue ?? ""}
                      maxLength={200}
                      className="h-8 w-40"
                    />
                  </div>
                  <SubmitButton variant="outline" size="sm" pendingLabel="Salvando…">
                    Salvar
                  </SubmitButton>
                </form>
                <p className="mt-2 text-xs text-muted-foreground">
                  Trocar o tipo não converte valores já salvos; só muda como condições e segmentos
                  os comparam daqui em diante.
                </p>

                <form action={deleteField} className="mt-3">
                  <input type="hidden" name="id" value={f.id} />
                  <ConfirmSubmitButton
                    variant="outline"
                    size="sm"
                    disabled={inUse}
                    className="text-destructive hover:bg-rose-50 hover:text-destructive"
                    title={`Excluir o campo "${f.key}"?`}
                    description={
                      contacts > 0
                        ? `O registro some da lista; os ${contacts} valor(es) já salvos nos contatos continuam lá, sem nome nem tipo, até um fluxo gravar a chave de novo.`
                        : "Nenhum contato tem valor neste campo. O registro some da lista."
                    }
                  >
                    Excluir
                  </ConfirmSubmitButton>
                  {inUse && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Remova o campo dos fluxos acima para poder excluir.
                    </span>
                  )}
                </form>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}

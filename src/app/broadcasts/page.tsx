import { Megaphone } from "lucide-react";
import { db } from "../../server/db";
import { previewAudience, audienceOf } from "../../server/broadcast-worker";
import { createBroadcast, queueBroadcast, deleteBroadcast } from "./actions";
import { AudiencePicker } from "./AudiencePicker";
import { FlowSelect } from "../configuracoes/FlowSelect";
import { accountTimeZone, formatInTimeZone } from "../../lib/timezone";
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
import { StatusPill } from "@/components/ui/status-pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { broadcastStatusLabel, broadcastStatusTone } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const timeZone = accountTimeZone();
  const [tags, segments, flows, broadcasts] = await Promise.all([
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    db.segment.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.flow.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.broadcast.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { _count: { select: { recipients: true } }, segment: true, flow: true },
    }),
  ]);

  // Per-draft window snapshots, resolved up front rather than inside the JSX
  // map: an async callback there returns Promises to React instead of nodes.
  const previews = new Map(
    await Promise.all(
      broadcasts
        .filter((b) => b.status === "DRAFT")
        .map(async (b) => [b.id, await previewAudience(db, audienceOf(b))] as const),
    ),
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Disparos"
        description="Uma mensagem para muitos contatos. Só chega em quem escreveu nas últimas 24 horas, por isso o número aparece antes de você disparar, e não só no relatório."
      />

      <Card className="mt-6">
        <CardContent className="p-4">
          <form action={createBroadcast} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bc-name">Nome interno</Label>
              <Input id="bc-name" name="name" maxLength={120} placeholder="ex: promoção de sexta" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bc-text">Mensagem</Label>
              <Textarea id="bc-text" name="text" rows={4} maxLength={1000} />
            </div>

            {flows.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="bc-flow">Ou enviar um fluxo (ignora a mensagem acima)</Label>
                <FlowSelect id="bc-flow" name="flowId" flows={flows} className="w-auto" />
              </div>
            )}

            <AudiencePicker tags={tags} />

            {segments.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="bc-segment">Segmento (opcional; substitui as etiquetas)</Label>
                <FlowSelect
                  id="bc-segment"
                  name="segmentId"
                  flows={segments}
                  noneLabel="nenhum"
                  className="w-auto"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="bc-when">Agendar para (opcional)</Label>
              <Input id="bc-when" type="datetime-local" name="scheduledAt" className="w-auto" />
              <p className="text-xs text-muted-foreground">
                Horário de {timeZone}. Depois de enfileirado, o disparo espera até esse momento.
              </p>
            </div>

            <SubmitButton pendingLabel="Salvando…">Salvar rascunho</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {broadcasts.length === 0 && (
        <EmptyState
          className="mt-6"
          icon={Megaphone}
          title="Nenhum disparo ainda."
          description="Salve um rascunho acima. Ele fica aqui até você enfileirar o envio."
        />
      )}

      <div className="mt-6 space-y-2">
        {broadcasts.map((b) => {
          // The window keeps closing, so a draft saved yesterday reaches
          // fewer people than it would have then.
          const p = previews.get(b.id) ?? null;

          return (
            <Card key={b.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{b.name}</span>
                  <StatusPill tone={broadcastStatusTone(b.status)}>
                    {broadcastStatusLabel(b.status)}
                  </StatusPill>
                  {b._count.recipients > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {b._count.recipients} destinatário(s)
                    </span>
                  )}
                  {b.segment && (
                    <span className="text-xs text-muted-foreground">
                      segmento: {b.segment.name}
                    </span>
                  )}
                  {b.scheduledAt && (
                    <span className="text-xs text-muted-foreground">
                      agendado para {formatInTimeZone(b.scheduledAt, timeZone)}
                    </span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700">
                  {b.flow ? `[fluxo: ${b.flow.name}]` : b.content ? "[bloco]" : b.text}
                </p>

                {p && (
                  <div
                    className={`mt-2 text-xs ${p.mostlyOutOfWindow ? "text-amber-800" : "text-neutral-600"}`}
                  >
                    {p.inWindow} de {p.total} contatos estão dentro da janela agora
                    {p.mostlyOutOfWindow && ". A maioria não vai receber"}
                  </div>
                )}

                {b.status === "DRAFT" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <form action={queueBroadcast} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={b.id} />
                      <Label htmlFor={`window-${b.id}`} className="sr-only">
                        Filtro da janela
                      </Label>
                      <Select name="window" defaultValue="in">
                        <SelectTrigger id={`window-${b.id}`} className="h-8 w-72 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in">Só quem está dentro da janela</SelectItem>
                          <SelectItem value="all">Todos (fora da janela vai falhar)</SelectItem>
                        </SelectContent>
                      </Select>
                      <SubmitButton size="sm" pendingLabel="Enfileirando…">
                        Enfileirar
                      </SubmitButton>
                    </form>
                    <form action={deleteBroadcast}>
                      <input type="hidden" name="id" value={b.id} />
                      <ConfirmSubmitButton
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-rose-50 hover:text-destructive"
                        title={`Excluir o rascunho "${b.name}"?`}
                        description="O texto e o filtro de público são perdidos."
                      >
                        Excluir
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}

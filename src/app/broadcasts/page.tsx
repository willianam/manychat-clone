import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { db } from "../../server/db";
import { previewAudience, audienceOf } from "../../server/broadcast-worker";
import { queueBroadcast, deleteBroadcast } from "./actions";
import { QueueBroadcastForm } from "./QueueBroadcastForm";
import { accountTimeZone, formatInTimeZone } from "../../lib/timezone";
import { formError } from "../../lib/ui/form-error";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { broadcastStatusLabel, broadcastStatusTone } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const erro = formError((await searchParams).erro);
  const timeZone = accountTimeZone();
  const now = new Date();
  const broadcasts = await db.broadcast.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      segment: { select: { name: true, rules: true } },
      flow: { select: { name: true } },
      recipients: { select: { status: true } },
    },
  });

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
        description="Uma mensagem para muitos contatos. Só chega em quem escreveu nas últimas 24 horas."
        actions={
          <Button asChild>
            <Link href="/broadcasts/novo">
              <Plus aria-hidden />
              Novo disparo
            </Link>
          </Button>
        }
      />

      {erro && (
        <Callout tone="destructive" className="mt-6">
          {erro}
        </Callout>
      )}

      {broadcasts.length === 0 && (
        <EmptyState
          className="mt-6"
          icon={Megaphone}
          title="Nenhum disparo ainda."
          description="Crie o primeiro: escolha o conteúdo, o público e quando sair."
          action={
            <Button asChild>
              <Link href="/broadcasts/novo">Novo disparo</Link>
            </Button>
          }
        />
      )}

      <ul className="mt-6 space-y-2">
        {broadcasts.map((b) => {
          const p = previews.get(b.id) ?? null;
          const total = b.recipients.length;
          const done = b.recipients.filter((r) => r.status !== "PENDING").length;
          const scheduledAhead = b.scheduledAt && b.scheduledAt > now;

          return (
            <li key={b.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href={`/broadcasts/${b.id}`}
                      className="font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {b.name}
                    </Link>
                    <StatusPill tone={broadcastStatusTone(b.status)}>
                      {b.status === "QUEUED" && scheduledAhead
                        ? "agendado"
                        : broadcastStatusLabel(b.status)}
                    </StatusPill>
                    {b.scheduledAt && (
                      <span className="text-xs text-muted-foreground">
                        {scheduledAhead ? "sai em" : "agendado para"}{" "}
                        {formatInTimeZone(b.scheduledAt, timeZone)}
                      </span>
                    )}
                    {b.segment && (
                      <span className="text-xs text-muted-foreground">
                        segmento: {b.segment.name}
                      </span>
                    )}
                    {b.tag && <span className="text-xs text-muted-foreground">tag {b.tag}</span>}
                  </div>

                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-neutral-700">
                    {b.flow ? `[fluxo: ${b.flow.name}]` : b.content ? "[bloco]" : b.text}
                  </p>

                  {total > 0 && (
                    <div className="mt-3" aria-label={`${done} de ${total} processados`}>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {done} de {total} processados
                        </span>
                        <span className="tabular-nums">{Math.round((done / total) * 100)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(done / total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {b.status !== "DRAFT" && p && (
                    <div
                      className={`mt-2 text-xs ${p.mostlyOutOfWindow ? "text-amber-800" : "text-neutral-600"}`}
                    >
                      {p.inWindow} de {p.total} contatos estão dentro da janela agora
                      {p.mostlyOutOfWindow && ". A maioria não vai receber"}
                    </div>
                  )}

                  {b.status === "DRAFT" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <QueueBroadcastForm
                        id={b.id}
                        action={queueBroadcast}
                        scheduled={Boolean(b.scheduledAt)}
                        preview={p ?? null}
                      />
                      <form action={deleteBroadcast} className="mt-3">
                        <input type="hidden" name="id" value={b.id} />
                        <ConfirmSubmitButton
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:bg-rose-50 hover:text-destructive"
                          title={`Excluir o rascunho "${b.name}"?`}
                          description="O conteúdo e o filtro de público são perdidos."
                        >
                          Excluir
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

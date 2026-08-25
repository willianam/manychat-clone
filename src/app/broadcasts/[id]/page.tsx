import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Copy, RotateCcw, Users, XCircle } from "lucide-react";
import { db } from "../../../server/db";
import {
  BUCKET_LABEL,
  broadcastDetail,
  type RecipientBucket,
} from "../../../server/broadcast-detail";
import { accountTimeZone, formatInTimeZone } from "../../../lib/timezone";
import { cancelBroadcastAction, duplicateBroadcastAction, retryFailedRecipients } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { broadcastStatusLabel, broadcastStatusTone } from "@/lib/ui/labels";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

const BUCKETS: RecipientBucket[] = ["sent", "delivered", "read", "failed", "skipped", "pending"];

const BUCKET_TONE: Record<
  RecipientBucket,
  "success" | "neutral" | "warning" | "destructive" | "info"
> = {
  pending: "info",
  sent: "success",
  delivered: "success",
  read: "success",
  failed: "destructive",
  skipped: "warning",
};

/**
 * One broadcast: what went out, to whom, and what to do about the rest.
 *
 * The status filter is a query param rather than client state so the URL of
 * "show me the failures" can be pasted, and so the table is server-rendered
 * with the same numbers as the cards above it.
 */
export default async function BroadcastPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const { status } = await searchParams;
  const bucket = BUCKETS.includes(status as RecipientBucket) ? (status as RecipientBucket) : null;

  const b = await db.broadcast.findUnique({
    where: { id },
    include: { segment: { select: { name: true } }, flow: { select: { name: true } } },
  });
  if (!b) notFound();

  const timeZone = accountTimeZone();
  const now = new Date();
  const detail = await broadcastDetail(db, id, { bucket });
  const { counts } = detail;
  const processed = counts.total - counts.pending;
  const scheduledAhead = b.scheduledAt && b.scheduledAt > now;
  const retryable = counts.failed > 0 && b.status !== "SENDING";

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <PageHeader
        title={b.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={broadcastStatusTone(b.status)}>
              {b.status === "QUEUED" && scheduledAhead
                ? "agendado"
                : broadcastStatusLabel(b.status)}
            </StatusPill>
            <span>criado em {formatInTimeZone(b.createdAt, timeZone)}</span>
            {b.scheduledAt && <span>· sai em {formatInTimeZone(b.scheduledAt, timeZone)}</span>}
            {b.segment && <span>· segmento {b.segment.name}</span>}
            {b.tag && <span>· tag {b.tag}</span>}
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/broadcasts">
                <ArrowLeft aria-hidden />
                Voltar
              </Link>
            </Button>
            <form action={duplicateBroadcastAction}>
              <input type="hidden" name="id" value={b.id} />
              <SubmitButton variant="outline" pendingLabel="Duplicando…">
                <Copy aria-hidden />
                Duplicar
              </SubmitButton>
            </form>
            {retryable && (
              <form action={retryFailedRecipients}>
                <input type="hidden" name="id" value={b.id} />
                <SubmitButton variant="outline" pendingLabel="Reenfileirando…">
                  <RotateCcw aria-hidden />
                  Reenviar falhas ({counts.failed})
                </SubmitButton>
              </form>
            )}
            {b.status === "QUEUED" && (
              <form action={cancelBroadcastAction}>
                <input type="hidden" name="id" value={b.id} />
                <ConfirmSubmitButton
                  variant="outline"
                  className="text-destructive hover:bg-rose-50 hover:text-destructive"
                  title="Cancelar este disparo?"
                  description="Ele volta a rascunho e os destinatários são descartados. Nada foi enviado ainda."
                  confirmLabel="Cancelar disparo"
                >
                  <XCircle aria-hidden />
                  Cancelar
                </ConfirmSubmitButton>
              </form>
            )}
          </>
        }
      />

      <Card className="mt-6">
        <CardContent className="p-4">
          <p className="whitespace-pre-wrap text-sm text-neutral-700">
            {b.flow ? `Envia o fluxo "${b.flow.name}"` : b.content ? "Bloco" : b.text}
          </p>
        </CardContent>
      </Card>

      {counts.total === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Users}
          title="Sem destinatários ainda."
          description={
            b.status === "DRAFT"
              ? "Os destinatários são escolhidos quando o rascunho entra na fila."
              : "Ninguém se encaixou no filtro na hora de enfileirar."
          }
        />
      ) : (
        <>
          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {processed} de {counts.total} processados
            </span>
            <span className="tabular-nums">{Math.round((processed / counts.total) * 100)}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(processed / counts.total) * 100}%` }}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {BUCKETS.map((k) => (
              <Link
                key={k}
                href={bucket === k ? `/broadcasts/${b.id}` : `/broadcasts/${b.id}?status=${k}`}
                aria-current={bucket === k ? "page" : undefined}
                className={cn(
                  "rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  bucket === k && "border-primary ring-1 ring-primary",
                )}
              >
                <div className="text-2xl font-semibold tabular-nums">{counts[k]}</div>
                <div className="text-xs text-muted-foreground">{BUCKET_LABEL[k]}</div>
              </Link>
            ))}
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Entregue e lido dependem dos recibos do Instagram (campo{" "}
            <code className="font-mono">messaging_seen</code> assinado no webhook); sem eles a linha
            para em enviado. Toque num cartão para filtrar a tabela.
          </p>

          <div className="mt-4 overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Enviado em</TableHead>
                  <TableHead>Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.recipients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Nenhum destinatário com esse estado.
                    </TableCell>
                  </TableRow>
                )}
                {detail.recipients.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">{r.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        @{r.username ?? "sem-user"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={BUCKET_TONE[r.bucket]}>{BUCKET_LABEL[r.bucket]}</StatusPill>
                    </TableCell>
                    <TableCell className="text-neutral-600">
                      {r.sentAt ? formatInTimeZone(r.sentAt, timeZone) : "—"}
                    </TableCell>
                    <TableCell className="max-w-md text-xs text-neutral-600">
                      {r.error ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {detail.recipients.length >= 500 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Mostrando os primeiros 500; filtre por estado para ver o resto.
            </p>
          )}
        </>
      )}
    </main>
  );
}

import Link from "next/link";
import { AlertTriangle, Megaphone, Workflow, Zap } from "lucide-react";
import { db } from "../server/db";
import { dashboardData } from "../server/dashboard";
import { accountTimeZone, formatInTimeZone } from "../lib/timezone";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SERIES, seriesColor } from "@/lib/ui/chart-palette";
import { broadcastStatusLabel, broadcastStatusTone } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

/**
 * The home page: a KPI row, three 30-day series, and the four lists that
 * answer "what is working and what broke" without opening anything else.
 * Numbers come from server/dashboard.ts; the charts are the only client
 * components on the page.
 */
export default async function Home() {
  const now = new Date();
  const timeZone = accountTimeZone();
  const d = await dashboardData(db, now);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageHeader
        title="Painel"
        description={`Últimos ${d.days} dias · dia civil em ${timeZone}. Os agregados diários são recalculados a cada evento do webhook e no tick do worker.`}
      />

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Contatos" value={d.cards.contacts} />
        <Stat label="Novos em 7 dias" value={d.cards.new7d} />
        <Stat label="Mensagens recebidas" value={d.cards.messagesIn7d} hint="7 dias" />
        <Stat label="Mensagens enviadas" value={d.cards.messagesOut7d} hint="7 dias" />
        <Stat
          label="Alcançáveis agora"
          value={d.cards.reachableNow}
          hint="dentro da janela de 24h"
        />
        <Stat label="Opt-outs em 7 dias" value={d.cards.optOuts7d} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <TimeSeriesChart
              kind="line"
              title="Contatos novos por dia"
              rows={d.contactsNew}
              series={[{ key: "value", label: "novos", color: SERIES[0] }]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <TimeSeriesChart
              kind="line"
              title="Mensagens por dia"
              rows={d.messages}
              series={[
                { key: "in", label: "recebidas", color: SERIES[0] },
                { key: "out", label: "enviadas", color: SERIES[1] },
              ]}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <TimeSeriesChart
              kind="stacked"
              title="Disparos de gatilho por dia"
              rows={d.triggerFires.rows}
              series={d.triggerFires.keys.map((k, i) => ({
                key: k.key,
                label: k.label,
                color: k.key === "other" ? seriesColor(99) : seriesColor(i),
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
              Gatilhos mais acionados (7 dias)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {d.topTriggers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum gatilho disparou esta semana.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {d.topTriggers.map((t, i) => (
                  <li key={t.id} className="flex items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: seriesColor(i) }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {t.label}
                      {t.flowName && <span className="text-muted-foreground"> → {t.flowName}</span>}
                    </span>
                    <span className="tabular-nums font-medium">{t.fires}</span>
                  </li>
                ))}
              </ol>
            )}
            <Link
              href="/gatilhos"
              className="mt-3 inline-block text-xs text-primary hover:underline"
            >
              Ver todos os gatilhos
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Workflow className="h-4 w-4 text-muted-foreground" aria-hidden />
              Fluxos com maior conclusão (30 dias)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {d.topFlows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum fluxo ativo rodou no período.</p>
            ) : (
              // Five numeric columns do not fit a 390px screen; the broadcast
              // recipients table solves it the same way.
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fluxo</TableHead>
                      <TableHead className="text-right">Iniciados</TableHead>
                      <TableHead className="text-right">Concluídos</TableHead>
                      <TableHead className="text-right">Metas</TableHead>
                      <TableHead className="text-right">Taxa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.topFlows.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell>
                          <Link href={`/flows/${f.id}`} className="hover:underline">
                            {f.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{f.started}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.completed}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.goals}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {f.rate === null ? "—" : `${f.rate}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" aria-hidden />
              Erros recentes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {d.recentErrors.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum erro registrado.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.recentErrors.map((e) => (
                  <li key={e.id}>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{e.scope}</code>
                      {formatInTimeZone(e.at, timeZone)}
                    </div>
                    <div className="truncate text-neutral-700">{e.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-4 w-4 text-muted-foreground" aria-hidden />
              Disparos recentes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {d.recentBroadcasts.length === 0 ? (
              <EmptyState
                icon={Megaphone}
                title="Nenhum disparo ainda."
                className="py-6"
                action={
                  <Link href="/broadcasts/novo" className="text-sm text-primary hover:underline">
                    Criar o primeiro
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {d.recentBroadcasts.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/broadcasts/${b.id}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {b.name}
                    </Link>
                    <StatusPill tone={broadcastStatusTone(b.status)}>
                      {broadcastStatusLabel(b.status)}
                    </StatusPill>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {b.sent}/{b.total} · {formatInTimeZone(b.createdAt, timeZone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-sm text-neutral-600">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

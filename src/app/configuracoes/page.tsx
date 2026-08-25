import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { db } from "../../server/db";
import {
  IceBreakersInput,
  MenuItemsInput,
  type IceBreakerInput,
  type MenuItemInput,
} from "../../lib/messenger-profile";
import { loadProfile, refreshTokenNow } from "./actions";
import { tokenStatus } from "../../server/token-refresh";
import { checkHealth } from "../../server/health";
import { listQuickReplies } from "../../server/inbox";
import { connectionStatus } from "../../server/connection-status";
import { KIND_LABEL, WEBHOOK_FIELDS, webhookStatus } from "../../server/webhook-status";
import { accountTimeZone, formatInTimeZone } from "../../lib/timezone";
import {
  ESCAPE_KEYWORDS,
  OPT_IN_CONFIRMATION,
  OPT_IN_KEYWORDS,
  OPT_OUT_CONFIRMATION,
  OPT_OUT_KEYWORDS,
} from "../../lib/global-keywords";
import { ProfileForms } from "./ProfileForms";
import { QuickRepliesManager } from "./QuickRepliesManager";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { SubmitButton } from "@/components/ui/submit-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { triggerKindLabel } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

const TABS = ["conexao", "automacao", "perfil", "respostas"] as const;
type Tab = (typeof TABS)[number];

/**
 * Settings, in four tabs. Everything on the connection tab is a *status*
 * derived from data the app already keeps (token row, last outbound
 * message, webhook events, error events); the only action is the forced
 * token refresh. Nothing here stores a secret or shows one.
 */
export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  const { aba } = await searchParams;
  const tab: Tab = TABS.includes(aba as Tab) ? (aba as Tab) : "conexao";
  const now = new Date();
  const timeZone = accountTimeZone();

  const [profile, flows, token, health, connection, webhook, defaults, welcomes, quickReplies] =
    await Promise.all([
      loadProfile(),
      db.flow.findMany({ orderBy: { name: "asc" } }),
      tokenStatus(db, now),
      checkHealth(db, now),
      connectionStatus(db, now),
      webhookStatus(db, now),
      db.trigger.findMany({
        where: { kind: "DEFAULT" },
        include: { flow: { select: { name: true, enabled: true } } },
        orderBy: { priority: "desc" },
      }),
      db.trigger.findMany({
        where: { kind: "WELCOME" },
        include: { flow: { select: { name: true, enabled: true } } },
        orderBy: { priority: "desc" },
      }),
      listQuickReplies(db),
    ]);

  // The stored JSON is re-parsed rather than trusted: a schema change or a
  // hand-edited row must not crash the settings screen.
  const iceBreakers: IceBreakerInput[] = IceBreakersInput.safeParse(profile.iceBreakers).data ?? [];
  const menuItems: MenuItemInput[] = MenuItemsInput.safeParse(profile.menuItems).data ?? [];
  const liveFlows = flows.filter((f) => f.enabled);

  const lastByKind = new Map(webhook.lastByKind.map((k) => [k.kind, k]));
  const username = process.env.IG_USERNAME ?? "";

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Configurações"
        description="Conexão com o Instagram, regras automáticas e o que aparece no perfil."
      />

      <Tabs defaultValue={tab} className="mt-6">
        <TabsList aria-label="Seções">
          <TabsTrigger value="conexao">Conexão</TabsTrigger>
          <TabsTrigger value="automacao">Automação</TabsTrigger>
          <TabsTrigger value="perfil">Perfil do Instagram</TabsTrigger>
          <TabsTrigger value="respostas">Respostas rápidas</TabsTrigger>
        </TabsList>

        {/* ---------------- Conexão ---------------- */}
        <TabsContent value="conexao" className="mt-4 space-y-6">
          {connection.level !== "ok" && (
            <Callout tone={connection.level === "down" ? "destructive" : "warning"}>
              <ul className="space-y-0.5">
                {connection.detail.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </Callout>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Conta e token
                <StatusPill
                  tone={
                    connection.level === "ok"
                      ? "success"
                      : connection.level === "warn"
                        ? "warning"
                        : "destructive"
                  }
                >
                  {connection.label}
                </StatusPill>
              </CardTitle>
              <CardDescription>
                O token de acesso do Instagram vive no banco e é renovado sozinho quando faltam
                menos de 10 dias. O valor nunca aparece aqui.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted-foreground">Conta</dt>
                <dd>{username ? `@${username}` : "IG_USERNAME não definido"}</dd>
                <dt className="text-muted-foreground">Token</dt>
                <dd>
                  {!token.configured
                    ? "não configurado (defina IG_ACCESS_TOKEN)"
                    : token.expiresAt
                      ? `válido até ${formatInTimeZone(token.expiresAt, timeZone)} (${token.daysLeft} dia(s))`
                      : "validade desconhecida até a primeira renovação"}
                </dd>
                <dt className="text-muted-foreground">Última renovação</dt>
                <dd>
                  {token.refreshedAt ? formatInTimeZone(token.refreshedAt, timeZone) : "nunca"}
                  {token.lastError && (
                    <span className="text-rose-700"> · falhou: {token.lastError}</span>
                  )}
                </dd>
                <dt className="text-muted-foreground">Última chamada à Meta</dt>
                <dd>
                  {health.lastMetaCall
                    ? `${formatInTimeZone(new Date(health.lastMetaCall.at), timeZone)} · ${health.lastMetaCall.ok ? "ok" : "falhou"}`
                    : "nenhuma mensagem enviada ainda"}
                </dd>
                <dt className="text-muted-foreground">Erros nas últimas 24h</dt>
                <dd>
                  {health.errors24h.count}
                  {health.errors24h.lastScope && ` · último em "${health.errors24h.lastScope}"`}
                </dd>
                <dt className="text-muted-foreground">Banco</dt>
                <dd>{health.db === "ok" ? "ok" : "fora do ar"}</dd>
              </dl>

              <form action={refreshTokenNow} className="mt-4">
                <SubmitButton
                  variant="outline"
                  disabled={!token.configured}
                  pendingLabel="Renovando…"
                >
                  <RefreshCw aria-hidden />
                  Renovar agora
                </SubmitButton>
              </form>
              <p className="mt-2 text-xs text-muted-foreground">
                A Meta recusa renovar um token com menos de 24 horas de vida. Se a renovação falhar
                de vez, gere um token novo no painel da Meta e atualize IG_ACCESS_TOKEN.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assinatura do webhook</CardTitle>
              <CardDescription>
                A Meta não conta ao app quais campos estão assinados. O que dá para saber é quando
                cada tipo de evento chegou pela última vez: um campo que nunca produziu evento ou
                está sem assinar, ou só está quieto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campo</TableHead>
                      <TableHead>Para quê</TableHead>
                      <TableHead>Último evento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {WEBHOOK_FIELDS.map((f) => {
                      const seen = f.kinds
                        .map((k) => lastByKind.get(k))
                        .filter((k): k is NonNullable<typeof k> => Boolean(k))
                        .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
                      return (
                        <TableRow key={f.field}>
                          <TableCell>
                            <code className="font-mono text-xs">{f.field}</code>
                          </TableCell>
                          <TableCell className="text-neutral-600">{f.purpose}</TableCell>
                          <TableCell>
                            {seen.length === 0 ? (
                              <StatusPill tone={f.optional ? "neutral" : "warning"}>
                                {f.optional ? "indisponível" : "nunca chegou"}
                              </StatusPill>
                            ) : (
                              <ul className="space-y-0.5 text-xs">
                                {seen.map((s) => (
                                  <li key={s.kind}>
                                    {KIND_LABEL[s.kind]}: {formatInTimeZone(s.lastAt, timeZone)}{" "}
                                    <span className="text-muted-foreground">({s.count})</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {webhook.received24h} evento(s) nas últimas 24h, {webhook.failed24h} com falha no
                processamento.{" "}
                <Link href="/api/health" className="text-primary hover:underline">
                  /api/health
                </Link>{" "}
                resume isto para um monitor externo.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Automação ---------------- */}
        <TabsContent value="automacao" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resposta padrão e boas-vindas</CardTitle>
              <CardDescription>
                O que responde quando nenhuma palavra-chave casa. São gatilhos como os outros; edite
                em{" "}
                <Link href="/gatilhos" className="text-primary hover:underline">
                  Gatilhos
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TriggerRows
                title="Primeira mensagem (boas-vindas)"
                empty="Nenhum gatilho de boas-vindas: a primeira DM de um contato novo cai na resposta padrão."
                rows={welcomes}
              />
              <TriggerRows
                title="Resposta padrão"
                empty="Nenhum gatilho padrão: uma mensagem sem palavra-chave fica sem resposta e vai para Insights."
                rows={defaults}
                className="mt-4"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Palavras globais</CardTitle>
              <CardDescription>
                Valem em qualquer conversa, antes de qualquer fluxo, só quando a mensagem é
                exatamente a palavra. Definidas no código (lib/global-keywords.ts).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted-foreground">Sair (opt-out)</dt>
                <dd>
                  <Keywords words={OPT_OUT_KEYWORDS} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Responde “{OPT_OUT_CONFIRMATION}”
                  </p>
                </dd>
                <dt className="text-muted-foreground">Voltar (opt-in)</dt>
                <dd>
                  <Keywords words={OPT_IN_KEYWORDS} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Responde “{OPT_IN_CONFIRMATION}”
                  </p>
                </dd>
                <dt className="text-muted-foreground">Escapar de um fluxo</dt>
                <dd>
                  <Keywords words={ESCAPE_KEYWORDS} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Abandona a sessão em andamento e trata a mensagem como nova (um gatilho “menu”
                    pode abrir o menu).
                  </p>
                </dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fuso horário</CardTitle>
              <CardDescription>
                Janelas de delay e agendamentos são lidos neste relógio, não no do servidor.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <span className="font-medium">{timeZone}</span>
              <span className="text-muted-foreground">
                {" "}
                · agora {formatInTimeZone(now, timeZone)}
              </span>
              <p className="mt-1 text-xs text-muted-foreground">
                Para mudar, defina ACCOUNT_TIMEZONE nas variáveis de ambiente.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Perfil ---------------- */}
        <TabsContent value="perfil" className="mt-4">
          <ProfileForms
            iceBreakers={iceBreakers}
            menuItems={menuItems}
            liveFlows={liveFlows}
            syncedAt={profile.syncedAt}
            syncError={profile.syncError}
          />
        </TabsContent>

        {/* ---------------- Respostas rápidas ---------------- */}
        <TabsContent value="respostas" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Respostas rápidas</CardTitle>
              <CardDescription>
                Atalhos de texto para responder à mão no inbox. Na caixa de resposta, digite / e o
                atalho para inserir o texto.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {quickReplies.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma resposta rápida cadastrada.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {quickReplies.map((q) => (
                    <li key={q.id} className="px-3 py-2">
                      <div className="text-sm">
                        <span className="font-medium">/{q.shortcut}</span>
                        <span className="ml-2 text-muted-foreground">{q.title}</span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{q.text}</p>
                    </li>
                  ))}
                </ul>
              )}
              <QuickRepliesManager items={quickReplies} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}

function Keywords({ words }: { words: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {words.map((w) => (
        <code key={w} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {w}
        </code>
      ))}
    </span>
  );
}

function TriggerRows({
  title,
  empty,
  rows,
  className,
}: {
  title: string;
  empty: string;
  rows: Array<{
    id: string;
    kind: string;
    enabled: boolean;
    flowId: string;
    flow: { name: string; enabled: boolean };
  }>;
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {rows.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{triggerKindLabel(t.kind)} →</span>
              <Link href={`/flows/${t.flowId}`} className="text-primary hover:underline">
                {t.flow.name}
              </Link>
              {!t.enabled ? (
                <StatusPill tone="neutral">desativado</StatusPill>
              ) : !t.flow.enabled ? (
                <StatusPill tone="warning">fluxo pausado</StatusPill>
              ) : (
                <StatusPill tone="success">no ar</StatusPill>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

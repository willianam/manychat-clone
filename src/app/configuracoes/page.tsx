import { db } from "../../server/db";
import {
  IceBreakersInput,
  MenuItemsInput,
  PROFILE_LIMITS,
  type IceBreakerInput,
  type MenuItemInput,
} from "../../lib/messenger-profile";
import { loadProfile, saveIceBreakers, saveMenu } from "./actions";
import { tokenStatus } from "../../server/token-refresh";
import { MenuRow } from "./MenuRow";
import { FlowSelect } from "./FlowSelect";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const [profile, flows, token] = await Promise.all([
    loadProfile(),
    db.flow.findMany({ orderBy: { name: "asc" } }),
    tokenStatus(db),
  ]);

  // The stored JSON is re-parsed rather than trusted: a schema change or a
  // hand-edited row must not crash the settings screen.
  const iceBreakers: IceBreakerInput[] = IceBreakersInput.safeParse(profile.iceBreakers).data ?? [];
  const menuItems: MenuItemInput[] = MenuItemsInput.safeParse(profile.menuItems).data ?? [];

  const liveFlows = flows.filter((f) => f.enabled);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Configurações"
        description="Perguntas iniciais e menu fixo. Publicado direto no seu Instagram."
      />

      {token.needsAttention && (
        <Callout tone="warning" className="mt-4">
          {token.lastError
            ? `A renovação automática do token do Instagram falhou: ${token.lastError}.`
            : `O token do Instagram expira em ${token.daysLeft} dia(s).`}{" "}
          Gere um token novo no painel da Meta e atualize IG_ACCESS_TOKEN; o valor novo passa a
          valer em até um minuto.
        </Callout>
      )}

      {profile.syncError && (
        <Callout tone="destructive" className="mt-4">
          Última publicação falhou: {profile.syncError}
        </Callout>
      )}
      {profile.syncedAt && !profile.syncError && (
        <p className="mt-4 text-xs text-muted-foreground">
          Publicado em {profile.syncedAt.toLocaleString("pt-BR")}.
        </p>
      )}

      {liveFlows.length === 0 && (
        <Callout tone="warning" className="mt-4">
          Nenhum fluxo ativo. Ative um fluxo antes de publicar: o Instagram só aceita perguntas e
          itens que abrem algo.
        </Callout>
      )}

      {/* ---------------- Ice breakers ---------------- */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">Perguntas iniciais</CardTitle>
          <CardDescription>
            Até {PROFILE_LIMITS.iceBreakers} perguntas que aparecem antes da primeira mensagem.
            Deixe em branco para remover.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveIceBreakers} className="space-y-3">
            {Array.from({ length: PROFILE_LIMITS.iceBreakers }).map((_, i) => {
              const row = iceBreakers[i];
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="w-4 text-sm tabular-nums text-neutral-400" aria-hidden>
                    {i + 1}
                  </span>
                  <Label htmlFor={`ice-q-${i}`} className="sr-only">
                    Pergunta {i + 1}
                  </Label>
                  <Input
                    id={`ice-q-${i}`}
                    name="question"
                    defaultValue={row?.question ?? ""}
                    maxLength={PROFILE_LIMITS.iceBreakerQuestion}
                    placeholder="Como funciona?"
                    className="min-w-0 flex-1"
                  />
                  <Label htmlFor={`ice-flow-${i}`} className="sr-only">
                    Fluxo da pergunta {i + 1}
                  </Label>
                  <FlowSelect
                    id={`ice-flow-${i}`}
                    name="iceFlowId"
                    defaultValue={row?.flowId ?? ""}
                    flows={liveFlows}
                    className="w-52"
                  />
                </div>
              );
            })}

            <SubmitButton pendingLabel="Publicando…">Publicar perguntas</SubmitButton>
          </form>
        </CardContent>
      </Card>

      {/* ---------------- Persistent menu ---------------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Menu fixo</CardTitle>
          <CardDescription>
            Até {PROFILE_LIMITS.menuItems} itens sempre visíveis na conversa. Cada item abre um
            fluxo ou um link externo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveMenu} className="space-y-3">
            {Array.from({ length: PROFILE_LIMITS.menuItems }).map((_, i) => (
              <MenuRow key={i} index={i} item={menuItems[i]} flows={liveFlows} />
            ))}

            <SubmitButton pendingLabel="Publicando…">Publicar menu</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

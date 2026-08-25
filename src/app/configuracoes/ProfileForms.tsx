import {
  PROFILE_LIMITS,
  type IceBreakerInput,
  type MenuItemInput,
} from "../../lib/messenger-profile";
import { saveIceBreakers, saveMenu } from "./actions";
import { MenuRow } from "./MenuRow";
import { FlowSelect } from "./FlowSelect";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Ice breakers and persistent menu, exactly as the settings page had them
 * before the tabs — moved into their own file so the page reads as a list
 * of tabs rather than one long form.
 */
export function ProfileForms({
  iceBreakers,
  menuItems,
  liveFlows,
  syncedAt,
  syncError,
}: {
  iceBreakers: IceBreakerInput[];
  menuItems: MenuItemInput[];
  liveFlows: Array<{ id: string; name: string }>;
  syncedAt: Date | null;
  syncError: string | null;
}) {
  return (
    <div className="space-y-6">
      {syncError && <Callout tone="destructive">Última publicação falhou: {syncError}</Callout>}
      {syncedAt && !syncError && (
        <p className="text-xs text-muted-foreground">
          Publicado em {syncedAt.toLocaleString("pt-BR")}.
        </p>
      )}

      {liveFlows.length === 0 && (
        <Callout tone="warning">
          Nenhum fluxo ativo. Ative um fluxo antes de publicar: o Instagram só aceita perguntas e
          itens que abrem algo.
        </Callout>
      )}

      <Card>
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

      <Card>
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
    </div>
  );
}

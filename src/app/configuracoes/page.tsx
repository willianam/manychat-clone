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
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="mt-0.5 text-sm text-neutral-500">
          Perguntas iniciais e menu fixo. Publicado direto no seu Instagram.
        </p>
      </div>

      {token.needsAttention && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {token.lastError
            ? `A renovação automática do token do Instagram falhou: ${token.lastError}.`
            : `O token do Instagram expira em ${token.daysLeft} dia(s).`}{" "}
          Gere um token novo no painel da Meta e atualize IG_ACCESS_TOKEN; o valor novo passa a
          valer em até um minuto.
        </p>
      )}

      {profile.syncError && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Última publicação falhou: {profile.syncError}
        </p>
      )}
      {profile.syncedAt && !profile.syncError && (
        <p className="mt-4 text-xs text-neutral-500">
          Publicado em {profile.syncedAt.toLocaleString("pt-BR")}.
        </p>
      )}

      {liveFlows.length === 0 && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nenhum fluxo ativo. Ative um fluxo antes de publicar — o Instagram só aceita perguntas e
          itens que abrem algo.
        </p>
      )}

      {/* ---------------- Ice breakers ---------------- */}
      <section className="mt-8 rounded-xl border bg-white p-5">
        <h2 className="font-medium">Perguntas iniciais</h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          Até {PROFILE_LIMITS.iceBreakers} perguntas que aparecem antes da primeira mensagem. Deixe
          em branco para remover.
        </p>

        <form action={saveIceBreakers} className="mt-4 space-y-3">
          {Array.from({ length: PROFILE_LIMITS.iceBreakers }).map((_, i) => {
            const row = iceBreakers[i];
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-4 text-sm text-neutral-400 tabular-nums">{i + 1}</span>
                <input
                  name="question"
                  defaultValue={row?.question ?? ""}
                  maxLength={PROFILE_LIMITS.iceBreakerQuestion}
                  placeholder="Como funciona?"
                  className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                />
                <select
                  name="iceFlowId"
                  defaultValue={row?.flowId ?? ""}
                  className="w-52 rounded-lg border bg-white px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                >
                  <option value="">— sem fluxo —</option>
                  {liveFlows.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            Publicar perguntas
          </button>
        </form>
      </section>

      {/* ---------------- Persistent menu ---------------- */}
      <section className="mt-6 rounded-xl border bg-white p-5">
        <h2 className="font-medium">Menu fixo</h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          Até {PROFILE_LIMITS.menuItems} itens sempre visíveis na conversa. Cada item abre um fluxo
          ou um link externo.
        </p>

        <form action={saveMenu} className="mt-4 space-y-3">
          {Array.from({ length: PROFILE_LIMITS.menuItems }).map((_, i) => (
            <MenuRow key={i} index={i} item={menuItems[i]} flows={liveFlows} />
          ))}

          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-700"
          >
            Publicar menu
          </button>
        </form>
      </section>
    </main>
  );
}

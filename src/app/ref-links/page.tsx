import QRCode from "qrcode";
import { Link2, Plus } from "lucide-react";
import { db } from "../../server/db";
import { refLinkUrl } from "../../lib/entry-events";
import { refLinkStats } from "../../server/ref-link-stats";
import { CopyLink } from "./CopyLink";
import { LinkInsights } from "./LinkInsights";
import { createRefLink, setRefLinkEnabled, deleteRefLink } from "./actions";
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
import { StatusPill } from "@/components/ui/status-pill";
import { SubmitButton } from "@/components/ui/submit-button";

export const dynamic = "force-dynamic";

/**
 * The IG handle the links point at. Without it we cannot build a usable url,
 * so the page says so rather than printing a broken link.
 */
const USERNAME = process.env.IG_USERNAME ?? "";

export default async function RefLinksPage() {
  const [links, flows] = await Promise.all([
    db.refLink.findMany({ include: { flow: true }, orderBy: { createdAt: "desc" } }),
    db.flow.findMany({ orderBy: { name: "asc" } }),
  ]);
  const stats = await refLinkStats(
    db,
    links.map((l) => l.code),
  );

  // QR codes need the full url, hence the username; without it there is
  // nothing to encode and the section simply omits them.
  const qrByCode = new Map(
    USERNAME
      ? await Promise.all(
          links.map(
            async (l) =>
              [
                l.code,
                await QRCode.toDataURL(refLinkUrl(USERNAME, l.code), { width: 512, margin: 1 }),
              ] as const,
          ),
        )
      : [],
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Links rastreáveis"
        description={
          <>
            Um link <code className="font-mono text-xs">ig.me</code> que abre a DM já disparando um
            fluxo. Use um por canal para saber de onde vem cada contato.
          </>
        }
      />

      {!USERNAME && (
        <Callout tone="warning" className="mt-4">
          Defina <code className="font-mono text-xs">IG_USERNAME</code> nas variáveis de ambiente
          para gerar os links completos.
        </Callout>
      )}

      {flows.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Link2}
          title="Crie um fluxo antes de criar um link."
          description="Um link precisa de um fluxo para disparar."
        />
      ) : (
        <Card className="mt-6">
          <CardContent className="p-4">
            <form action={createRefLink} className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rl-label">Nome</Label>
                <Input
                  id="rl-label"
                  name="label"
                  required
                  maxLength={120}
                  placeholder="Bio do Instagram"
                  className="w-48"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rl-flow">Fluxo</Label>
                <Select name="flowId" required defaultValue={flows[0]?.id}>
                  <SelectTrigger id="rl-flow" className="w-56">
                    <SelectValue placeholder="escolha…" />
                  </SelectTrigger>
                  <SelectContent>
                    {flows.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                        {f.enabled ? "" : " (desativado)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rl-code">Código (opcional)</Label>
                <Input
                  id="rl-code"
                  name="code"
                  maxLength={250}
                  placeholder="gerado automaticamente"
                  className="w-52 font-mono"
                />
              </div>

              <SubmitButton pendingLabel="Criando…">
                <Plus aria-hidden />
                Criar link
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      )}

      <ul className="mt-6 space-y-3">
        {links.map((link) => (
          <li key={link.id}>
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      {link.label}
                      {!link.enabled && <StatusPill tone="neutral">pausado</StatusPill>}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Dispara <span className="text-neutral-700">{link.flow.name}</span>
                      {!link.flow.enabled && (
                        <span className="text-amber-700">
                          {" "}
                          (fluxo desativado, nada será enviado)
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-medium tabular-nums">
                        {link.clicks} {link.clicks === 1 ? "clique" : "cliques"}
                      </p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {link.conversions} no fluxo
                      </p>
                    </div>

                    <form action={setRefLinkEnabled}>
                      <input type="hidden" name="id" value={link.id} />
                      <input type="hidden" name="enabled" value={String(!link.enabled)} />
                      <SubmitButton variant="outline" size="sm">
                        {link.enabled ? "Pausar" : "Ativar"}
                      </SubmitButton>
                    </form>

                    <form action={deleteRefLink}>
                      <input type="hidden" name="id" value={link.id} />
                      <ConfirmSubmitButton
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-rose-50 hover:text-destructive"
                        title={`Excluir o link "${link.label}"?`}
                        description="Quem abrir esse link depois cai numa DM comum, sem fluxo. Os cliques contados são perdidos."
                      >
                        Excluir
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                </div>

                {USERNAME && (
                  <div className="mt-3">
                    <CopyLink url={refLinkUrl(USERNAME, link.code)} />
                  </div>
                )}

                <LinkInsights
                  code={link.code}
                  rows={stats.byCode.get(link.code) ?? []}
                  qrDataUrl={qrByCode.get(link.code) ?? null}
                />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {links.length === 0 && flows.length > 0 && (
        <EmptyState
          className="mt-6"
          icon={Link2}
          title="Nenhum link criado ainda."
          description="Crie um acima e cole na bio, em anúncios ou em stories."
        />
      )}
    </main>
  );
}

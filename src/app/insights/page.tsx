import Link from "next/link";
import { Inbox } from "lucide-react";
import { db } from "../../server/db";
import { createTriggerFromUnmatched, dismissUnmatched, restoreUnmatched } from "./actions";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/ui/cn";

export const dynamic = "force-dynamic";

/**
 * "Digitaram e não casou".
 *
 * Every inbound message that fired no trigger lands here, aggregated by its
 * normalized form — so the list is ranked by how many real people asked,
 * not by how many rows we happened to write. The whole screen is pointed at
 * one decision: is this phrase worth a keyword?
 */
export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ mostrar?: string }>;
}) {
  const { mostrar } = await searchParams;
  const showResolved = mostrar === "resolvidas";

  const [rows, flows, pendingCount] = await Promise.all([
    db.unmatchedMessage.findMany({
      where: showResolved ? { resolvedAt: { not: null } } : { resolvedAt: null },
      orderBy: [{ count: "desc" }, { lastSeenAt: "desc" }],
      take: 100,
    }),
    db.flow.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.unmatchedMessage.count({ where: { resolvedAt: null } }),
  ]);

  const totalMisses = rows.reduce((n, r) => n + r.count, 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="O que digitaram e não casou"
        description="Mensagens que não bateram com nenhum gatilho, agrupadas por texto. Uma linha pode representar muita gente; use a contagem para decidir o que vira palavra-chave."
      />

      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <nav
          aria-label="Filtro"
          className="inline-flex items-center rounded-lg bg-muted p-1 text-muted-foreground"
        >
          <FilterTab href="/insights" active={!showResolved}>
            Pendentes ({pendingCount})
          </FilterTab>
          <FilterTab href="/insights?mostrar=resolvidas" active={showResolved}>
            Já resolvidas
          </FilterTab>
        </nav>
        {!showResolved && totalMisses > 0 && (
          <span className="ml-auto text-muted-foreground">
            {totalMisses} mensagem{totalMisses === 1 ? "" : "s"} sem resposta automática
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <EmptyState
          className="mt-6"
          icon={Inbox}
          title={showResolved ? "Nada resolvido ainda." : "Nenhuma mensagem sem gatilho."}
          description={
            showResolved
              ? undefined
              : "Quando alguém escrever algo que os seus gatilhos não cobrem, aparece aqui."
          }
        />
      )}

      <div className="mt-4 space-y-2">
        {rows.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums",
                    r.count >= 10 ? "bg-amber-100 text-amber-900" : "bg-muted text-neutral-700",
                  )}
                  title={`${r.count} pessoa(s) escreveram algo equivalente`}
                >
                  {r.count}×
                </span>

                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.sample}</div>
                  {r.normalized !== r.sample.toLowerCase() && (
                    <div className="truncate text-xs text-muted-foreground">
                      agrupado como “{r.normalized}”
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    primeira vez {fmt(r.firstSeenAt)} · última vez {fmt(r.lastSeenAt)}
                  </div>
                </div>
              </div>

              {showResolved ? (
                <form action={restoreUnmatched} className="mt-3">
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton variant="link" size="sm" className="h-auto p-0">
                    Voltar para pendentes
                  </SubmitButton>
                </form>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form
                    action={createTriggerFromUnmatched}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <Label htmlFor={`flow-${r.id}`} className="sr-only">
                      Fluxo
                    </Label>
                    <Select name="flowId" required>
                      <SelectTrigger id={`flow-${r.id}`} className="h-8 w-56 text-xs">
                        <SelectValue placeholder="escolha o fluxo…" />
                      </SelectTrigger>
                      <SelectContent>
                        {flows.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <SubmitButton size="sm" disabled={flows.length === 0} pendingLabel="Criando…">
                      Criar gatilho com isso
                    </SubmitButton>
                  </form>

                  <form action={dismissUnmatched}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton variant="outline" size="sm">
                      Ignorar
                    </SubmitButton>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {flows.length === 0 && rows.length > 0 && (
        <Callout tone="warning" className="mt-4">
          Crie um fluxo antes para poder apontar um gatilho para ele.
        </Callout>
      )}
    </main>
  );
}

function FilterTab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

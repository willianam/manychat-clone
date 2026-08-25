import Link from "next/link";
import { ArrowRight, Check, Users, Workflow, X } from "lucide-react";
import { db } from "../server/db";
import { canSend, windowRemainingMs } from "../lib/messaging-window";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { triggerKindLabel } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [contacts, flows, tags] = await Promise.all([
    db.contact.findMany({ orderBy: { createdAt: "asc" } }),
    db.flow.findMany({ include: { triggers: true } }),
    db.tag.findMany(),
  ]);

  const reachable = contacts.filter((c) => canSend(c.lastInboundAt).allowed).length;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageHeader
        title="Painel"
        description="Conectado ao Postgres de produção. O envio de mensagens depende das credenciais da Meta."
      />

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Contatos" value={contacts.length} />
        <Stat label="Alcançáveis agora" value={reachable} hint="dentro da janela de 24h" />
        <Stat label="Fluxos" value={flows.length} />
        <Stat label="Etiquetas" value={tags.length} />
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Fluxos</h2>
        {flows.length === 0 ? (
          <EmptyState
            className="mt-3"
            icon={Workflow}
            title="Nenhum fluxo ainda."
            description="Crie o primeiro escolhendo o que deve iniciá-lo."
            action={
              <Button asChild>
                <Link href="/flows">Ir para fluxos</Link>
              </Button>
            }
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {flows.map((f) => {
              const graph = f.graph as unknown as { nodes: unknown[] };
              return (
                <li key={f.id}>
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          href={`/flows/${f.id}`}
                          className="font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {f.name}
                        </Link>
                        <StatusPill tone={f.enabled ? "success" : "neutral"}>
                          {f.enabled ? "ativo" : "inativo"}
                        </StatusPill>
                        <span className="text-xs text-muted-foreground">
                          {graph.nodes.length} nós
                        </span>
                      </div>
                      {f.triggers.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {f.triggers.map((t) => (
                            <code
                              key={t.id}
                              className="rounded bg-muted px-2 py-0.5 text-xs text-neutral-700"
                            >
                              {triggerKindLabel(t.kind)}
                              {t.pattern ? `: "${t.pattern}"` : ""}
                            </code>
                          ))}
                        </div>
                      )}
                      <Button asChild size="sm" className="mt-3">
                        <Link href={`/flows/${f.id}`}>
                          Abrir editor visual
                          <ArrowRight aria-hidden />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Contatos e a janela de 24h</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A regra da Meta que o sistema aplica antes de qualquer envio.
        </p>
        {contacts.length === 0 ? (
          <EmptyState
            className="mt-3"
            icon={Users}
            title="Nenhum contato ainda."
            description="Contatos aparecem aqui assim que alguém escrever para a conta conectada."
          />
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>Última mensagem</TableHead>
                  <TableHead>Pode receber?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => {
                  const d = canSend(c.lastInboundAt);
                  const left = windowRemainingMs(c.lastInboundAt);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{c.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          @{c.username ?? "sem-user"}
                        </div>
                      </TableCell>
                      <TableCell className="text-neutral-600">
                        {c.lastInboundAt
                          ? `há ${Math.round((Date.now() - c.lastInboundAt.getTime()) / 3_600_000)}h`
                          : "nunca escreveu"}
                      </TableCell>
                      <TableCell>
                        {d.allowed ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <Check className="h-3.5 w-3.5" aria-hidden />
                            sim · restam {Math.round(left / 3_600_000)}h
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-700">
                            <X className="h-3.5 w-3.5" aria-hidden />
                            {d.reason}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
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

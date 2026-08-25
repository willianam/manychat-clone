import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Users } from "lucide-react";
import { db } from "../../server/db";
import { listContactSources, listContacts } from "../../server/contacts-list";
import { accountTimeZone, formatInTimeZone } from "../../lib/timezone";
import {
  hasFilters,
  parseContactQuery,
  serializeContactQuery,
  withQuery,
  type RawSearchParams,
} from "../../lib/contact-query";
import { windowState, windowSummary } from "../../lib/ui/window";
import { ContactsFilters } from "./ContactsFilters";
import { ContactsTable, type ContactListRow } from "./ContactsTable";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseContactQuery(await searchParams);
  const now = new Date();
  const timeZone = accountTimeZone();

  const [page, tags, sources, segments, flows] = await Promise.all([
    listContacts(db, query, now),
    db.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    listContactSources(db),
    db.segment.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.flow.findMany({
      where: { enabled: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows: ContactListRow[] = page.rows.map((c) => ({
    id: c.id,
    name: c.name,
    username: c.username,
    profilePic: c.profilePic,
    tags: c.tags.map((t) => t.tag),
    lastInboundLabel: c.lastInboundAt ? formatInTimeZone(c.lastInboundAt, timeZone) : null,
    window: windowState(c.lastInboundAt, now),
    windowLabel: windowSummary(c.lastInboundAt, now),
    subscribed: c.subscribed,
    source: c.source,
  }));

  const filtered = hasFilters(query);
  const exportHref = `/contacts/export${serializeContactQuery({ ...query, page: 1 })}`;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <PageHeader
        title="Contatos"
        description={`${page.total} ${page.total === 1 ? "contato" : "contatos"}${filtered ? " no filtro atual" : ""}`}
        actions={
          <>
            <Button asChild variant="outline">
              <a href={exportHref}>
                <Download aria-hidden />
                {filtered ? "Exportar filtrados" : "Exportar CSV"}
              </a>
            </Button>
          </>
        }
      />

      <div className="mt-6 rounded-xl border bg-card p-4">
        <ContactsFilters query={query} tags={tags} sources={sources} segments={segments} />
      </div>

      {page.total === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Users}
          title={filtered ? "Nenhum contato com esses filtros." : "Nenhum contato ainda."}
          description={
            filtered
              ? "Afrouxe um filtro ou limpe todos para ver a lista completa."
              : "Contatos aparecem aqui assim que alguém escrever para a conta conectada no Instagram."
          }
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href="/contacts">Limpar filtros</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="mt-6">
          <ContactsTable
            rows={rows}
            query={query}
            tags={tags.map((t) => ({ id: t.id, name: t.name }))}
            flows={flows}
          />
          <Pagination page={page.page} pageCount={page.pageCount} query={query} />
        </div>
      )}
    </main>
  );
}

function Pagination({
  page,
  pageCount,
  query,
}: {
  page: number;
  pageCount: number;
  query: ReturnType<typeof parseContactQuery>;
}) {
  if (pageCount <= 1) return null;
  const href = (p: number) => `/contacts${serializeContactQuery(withQuery(query, { page: p }))}`;
  return (
    <nav aria-label="Paginação" className="mt-4 flex items-center justify-between text-sm">
      <Button asChild variant="outline" size="sm" disabled={page <= 1}>
        {page <= 1 ? (
          <span aria-disabled>
            <ChevronLeft aria-hidden /> Anterior
          </span>
        ) : (
          <Link href={href(page - 1)}>
            <ChevronLeft aria-hidden /> Anterior
          </Link>
        )}
      </Button>
      <span className="text-muted-foreground" aria-current="page">
        Página {page} de {pageCount}
      </span>
      <Button asChild variant="outline" size="sm">
        {page >= pageCount ? (
          <span aria-disabled className="opacity-50">
            Próxima <ChevronRight aria-hidden />
          </span>
        ) : (
          <Link href={href(page + 1)}>
            Próxima <ChevronRight aria-hidden />
          </Link>
        )}
      </Button>
    </nav>
  );
}

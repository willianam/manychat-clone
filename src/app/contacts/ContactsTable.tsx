"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { bulkSetSubscribed, bulkStartFlow, bulkTag, exportSelectionCsv } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TagChip } from "@/components/ui/tag-chip";
import { withToast } from "@/lib/ui/action-toast";
import {
  serializeContactQuery,
  withQuery,
  type ContactQuery,
  type ContactSort,
} from "@/lib/contact-query";
import { cn } from "@/lib/ui/cn";

export type ContactListRow = {
  id: string;
  name: string | null;
  username: string | null;
  profilePic: string | null;
  tags: Array<{ id: string; name: string; color: string }>;
  /** Already formatted in the account's time zone; null when never. */
  lastInboundLabel: string | null;
  window: "in" | "out" | "never";
  windowLabel: string;
  subscribed: boolean;
  source: string | null;
};

type Option = { id: string; name: string };

const WINDOW_TONE = { in: "success", out: "neutral", never: "neutral" } as const;

/**
 * The list itself, plus row selection and the bulk bar it enables.
 *
 * Sorting is navigation (a header is a link), so it works without
 * JavaScript; selection and bulk actions are client-side because they act
 * on many rows at once and need the result before refreshing.
 */
export function ContactsTable({
  rows,
  query,
  tags,
  flows,
}: {
  rows: ContactListRow[];
  query: ContactQuery;
  tags: Option[];
  flows: Option[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOnPage = rows.some((r) => selected.has(r.id));

  const togglePage = () => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <BulkBar
          ids={Array.from(selected)}
          tags={tags}
          flows={flows}
          onDone={() => setSelected(new Set())}
        />
      )}

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Selecionar todos da página"
                  checked={allOnPage ? true : someOnPage ? "indeterminate" : false}
                  onCheckedChange={togglePage}
                />
              </TableHead>
              <SortHead query={query} sort="name">
                Nome
              </SortHead>
              <TableHead>Etiquetas</TableHead>
              <SortHead query={query} sort="lastInbound">
                Última interação
              </SortHead>
              <TableHead>Janela</TableHead>
              <TableHead>Inscrito</TableHead>
              <TableHead>Origem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id} data-state={selected.has(c.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox
                    aria-label={`Selecionar ${c.name ?? c.username ?? c.id}`}
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggle(c.id)}
                  />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/contacts/${c.id}`}
                    className="flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <Avatar name={c.name} username={c.username} src={c.profilePic} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name ?? "—"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        @{c.username ?? "sem-user"}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <TagChip key={t.id} name={t.name} color={t.color} />
                    ))}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {c.lastInboundLabel ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusPill tone={WINDOW_TONE[c.window]}>{c.windowLabel}</StatusPill>
                </TableCell>
                <TableCell>
                  <StatusPill tone={c.subscribed ? "success" : "destructive"}>
                    {c.subscribed ? "sim" : "não"}
                  </StatusPill>
                </TableCell>
                <TableCell className="text-muted-foreground">{c.source ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SortHead({
  query,
  sort,
  children,
}: {
  query: ContactQuery;
  sort: ContactSort;
  children: React.ReactNode;
}) {
  const active = query.sort === sort;
  const nextDir = active
    ? query.dir === "asc"
      ? "desc"
      : "asc"
    : sort === "name"
      ? "asc"
      : "desc";
  const Icon = !active ? ArrowUpDown : query.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={`/contacts${serializeContactQuery(withQuery(query, { sort, dir: nextDir }))}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          active && "text-foreground",
        )}
      >
        {children}
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </TableHead>
  );
}

function Avatar({
  name,
  username,
  src,
}: {
  name: string | null;
  username: string | null;
  src: string | null;
}) {
  const initial = (name ?? username ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {initial}
    </span>
  );
}

const NONE = "__none__";

function BulkBar({
  ids,
  tags,
  flows,
  onDone,
}: {
  ids: string[];
  tags: Option[];
  flows: Option[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tag, setTag] = useState(NONE);
  const [flow, setFlow] = useState(NONE);

  const run = (job: () => Promise<string | undefined>) =>
    start(async () => {
      const message = await withToast(job, { error: "Não foi possível aplicar a ação." });
      if (message === undefined) return;
      onDone();
      router.refresh();
    });

  const n = ids.length;
  const tagName = tags.find((t) => t.id === tag)?.name ?? "";

  return (
    <div
      role="region"
      aria-label="Ações em massa"
      aria-busy={pending}
      className="flex flex-wrap items-center gap-2 rounded-xl border bg-primary/5 px-3 py-2 text-sm"
    >
      <span className="font-medium tabular-nums" aria-live="polite">
        {n} selecionado{n === 1 ? "" : "s"}
      </span>

      {tags.length > 0 && (
        <div className="flex items-center gap-1">
          <Select value={tag} onValueChange={setTag}>
            <SelectTrigger aria-label="Etiqueta" className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>etiqueta…</SelectItem>
              {tags.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || tag === NONE}
            onClick={() =>
              run(async () => {
                const changed = await bulkTag(ids, tagName, "add");
                return `Etiqueta adicionada em ${changed} contato(s).`;
              })
            }
          >
            Adicionar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || tag === NONE}
            onClick={() =>
              run(async () => {
                const changed = await bulkTag(ids, tagName, "remove");
                return `Etiqueta removida de ${changed} contato(s).`;
              })
            }
          >
            Remover
          </Button>
        </div>
      )}

      {flows.length > 0 && (
        <div className="flex items-center gap-1">
          <Select value={flow} onValueChange={setFlow}>
            <SelectTrigger aria-label="Fluxo" className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>fluxo…</SelectItem>
              {flows.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || flow === NONE}
            onClick={() =>
              run(async () => {
                const r = await bulkStartFlow(ids, flow);
                return `Fluxo iniciado para ${r.started}; ${r.skipped} ignorado(s) (descadastrados ou já no fluxo).`;
              })
            }
          >
            Inscrever no fluxo
          </Button>
        </div>
      )}

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(async () => {
            await bulkSetSubscribed(ids, true);
            return `${n} contato(s) inscrito(s).`;
          })
        }
      >
        Inscrever
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        className="text-destructive hover:text-destructive"
        onClick={() =>
          run(async () => {
            await bulkSetSubscribed(ids, false);
            return `${n} contato(s) descadastrado(s).`;
          })
        }
      >
        Descadastrar
      </Button>

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const csv = await withToast(() => exportSelectionCsv(ids), {
              error: "Não foi possível exportar.",
            });
            if (csv === undefined) return;
            downloadText(csv, `contatos-selecao-${new Date().toISOString().slice(0, 10)}.csv`);
          })
        }
      >
        <Download aria-hidden />
        Exportar CSV
      </Button>

      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDone}>
        Limpar seleção
      </Button>
    </div>
  );
}

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

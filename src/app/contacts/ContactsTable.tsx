"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { bulkSetSubscribed, bulkStartFlow, bulkTag, exportSelectionCsv } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { isActionFailure, type ActionFailure } from "@/lib/ui/action-result";
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
              {/*
                Seven columns do not fit a phone. Below md the secondary ones
                are hidden and the essentials (etiquetas, janela, inscrito)
                move under the name in the first cell, so the table stops
                scrolling sideways instead of hiding data behind a swipe.
              */}
              <TableHead className="hidden md:table-cell">Etiquetas</TableHead>
              <SortHead query={query} sort="lastInbound" className="hidden md:table-cell">
                Última interação
              </SortHead>
              <TableHead className="hidden md:table-cell">Janela</TableHead>
              <TableHead className="hidden md:table-cell">Inscrito</TableHead>
              <TableHead className="hidden md:table-cell">Origem</TableHead>
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
                      {/* What the hidden columns carried, for small screens. */}
                      <span className="mt-1 flex flex-wrap items-center gap-1 md:hidden">
                        <StatusPill tone={WINDOW_TONE[c.window]}>{c.windowLabel}</StatusPill>
                        {!c.subscribed && <StatusPill tone="destructive">não inscrito</StatusPill>}
                        {c.tags.map((t) => (
                          <TagChip key={t.id} name={t.name} color={t.color} />
                        ))}
                      </span>
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <TagChip key={t.id} name={t.name} color={t.color} />
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                  {c.lastInboundLabel ?? "—"}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <StatusPill tone={WINDOW_TONE[c.window]}>{c.windowLabel}</StatusPill>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <StatusPill tone={c.subscribed ? "success" : "destructive"}>
                    {c.subscribed ? "sim" : "não"}
                  </StatusPill>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {c.source ?? "—"}
                </TableCell>
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
  className,
}: {
  query: ContactQuery;
  sort: ContactSort;
  children: React.ReactNode;
  className?: string;
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
    <TableHead
      className={className}
      aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
    >
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
  const [confirmUnsubscribe, setConfirmUnsubscribe] = useState(false);
  const [confirmStartFlow, setConfirmStartFlow] = useState(false);

  // A job returns the success sentence, or the action's own failure value,
  // which `withToast` turns into the toast the operator reads.
  const run = (job: () => Promise<string | ActionFailure | undefined>) =>
    start(async () => {
      const message = await withToast(job, { error: "Não foi possível aplicar a ação." });
      if (message === undefined) return;
      onDone();
      router.refresh();
    });

  const n = ids.length;
  const tagName = tags.find((t) => t.id === tag)?.name ?? "";
  const flowName = flows.find((f) => f.id === flow)?.name ?? "";

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
                if (isActionFailure(changed)) return changed;
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
            onClick={() => setConfirmStartFlow(true)}
          >
            Inscrever no fluxo
          </Button>
          {/*
            Starting a flow in bulk sends real DMs the moment it is clicked and
            nothing recalls them, so it asks first — the same rule "Descadastrar"
            below already follows, and this one is the less reversible of the two.
          */}
          <ConfirmDialog
            open={confirmStartFlow}
            onOpenChange={setConfirmStartFlow}
            title={`Iniciar "${flowName}" para ${n} contato${n === 1 ? "" : "s"}?`}
            description="As mensagens do fluxo saem imediatamente e não há como recolhê-las. Contatos descadastrados ou já neste fluxo são ignorados."
            confirmLabel="Inscrever no fluxo"
            pending={pending}
            onConfirm={() => {
              setConfirmStartFlow(false);
              run(async () => {
                const r = await bulkStartFlow(ids, flow);
                if (isActionFailure(r)) return r;
                return `Fluxo iniciado para ${r.started}; ${r.skipped} ignorado(s) (descadastrados ou já no fluxo).`;
              });
            }}
          />
        </div>
      )}

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const r = await bulkSetSubscribed(ids, true);
            if (isActionFailure(r)) return r;
            return `${n} contato(s) inscrito(s).`;
          })
        }
      >
        Inscrever
      </Button>
      {/*
        Opting people out in bulk is not undoable from the operator's side —
        a contact has to write in again to come back — so it asks first, and
        the question names how many are affected.
      */}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirmUnsubscribe(true)}
      >
        Descadastrar
      </Button>
      <ConfirmDialog
        open={confirmUnsubscribe}
        onOpenChange={setConfirmUnsubscribe}
        title={`Descadastrar ${n} contato${n === 1 ? "" : "s"}?`}
        description="Eles param de receber disparos e qualquer fluxo em andamento é encerrado. Só voltam a receber se pedirem de novo."
        confirmLabel="Descadastrar"
        destructive
        pending={pending}
        onConfirm={() => {
          setConfirmUnsubscribe(false);
          run(async () => {
            const r = await bulkSetSubscribed(ids, false);
            if (isActionFailure(r)) return r;
            return `${n} contato(s) descadastrado(s).`;
          });
        }}
      />

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

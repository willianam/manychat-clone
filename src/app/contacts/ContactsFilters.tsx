"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagChip } from "@/components/ui/tag-chip";
import {
  hasFilters,
  serializeContactQuery,
  withQuery,
  type ContactQuery,
} from "@/lib/contact-query";

/** Radix Select cannot hold "" as an item; this sentinel means "any". */
const ANY = "__any__";

type Option = { id: string; name: string };

/**
 * The filter bar. Every change is a navigation: the URL is the state, the
 * server re-renders the page, and the back button walks through views.
 * The search box waits 300ms so typing does not fire a request per key.
 */
export function ContactsFilters({
  query,
  tags,
  sources,
  segments,
}: {
  query: ContactQuery;
  tags: Array<Option & { color: string }>;
  sources: string[];
  segments: Option[];
}) {
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState(query.q);

  const go = (patch: Partial<ContactQuery>) =>
    router.push(`/contacts${serializeContactQuery(withQuery(query, patch))}`);

  useEffect(() => {
    setQ(query.q);
  }, [query.q]);

  useEffect(() => {
    if (q === query.q) return;
    const t = setTimeout(() => go({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const toggleTag = (tagId: string) =>
    go({
      tags: query.tags.includes(tagId)
        ? query.tags.filter((t) => t !== tagId)
        : [...query.tags, tagId],
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor={`${id}-q`}>Buscar</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              id={`${id}-q`}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="nome ou @username"
              className="pl-8"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-sub`}>Inscrito</Label>
          <Select
            value={query.subscribed === undefined ? ANY : String(query.subscribed)}
            onValueChange={(v) => go({ subscribed: v === ANY ? undefined : v === "true" })}
          >
            <SelectTrigger id={`${id}-sub`} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>todos</SelectItem>
              <SelectItem value="true">inscritos</SelectItem>
              <SelectItem value="false">descadastrados</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-win`}>Janela de 24h</Label>
          <Select
            value={query.window ?? ANY}
            onValueChange={(v) => go({ window: v === ANY ? undefined : (v as "in" | "out") })}
          >
            <SelectTrigger id={`${id}-win`} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>qualquer</SelectItem>
              <SelectItem value="in">dentro</SelectItem>
              <SelectItem value="out">fora</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {sources.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-src`}>Origem</Label>
            <Select
              value={query.source ?? ANY}
              onValueChange={(v) => go({ source: v === ANY ? undefined : v })}
            >
              <SelectTrigger id={`${id}-src`} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>qualquer</SelectItem>
                {sources.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {segments.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-seg`}>Segmento</Label>
            <Select
              value={query.segment ?? ANY}
              onValueChange={(v) => go({ segment: v === ANY ? undefined : v })}
            >
              <SelectTrigger id={`${id}-seg`} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>nenhum</SelectItem>
                {segments.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {hasFilters(query) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => router.push("/contacts")}>
            <X aria-hidden />
            Limpar filtros
          </Button>
        )}
      </div>

      {tags.length > 0 && (
        <fieldset>
          <legend className="text-xs font-medium text-muted-foreground">Etiquetas</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const on = query.tags.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleTag(t.id)}
                  className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <TagChip name={t.name} color={t.color} selected={on} />
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}

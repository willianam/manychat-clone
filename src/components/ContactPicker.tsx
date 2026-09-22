"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/ui/cn";

/**
 * Pick one contact by @username.
 *
 * Extracted from TestFlowDialog when the broadcast composer needed the same
 * thing: a debounced lookup, a radiogroup of matches, and a single pick.
 * Only the search is shared — what happens to the picked contact is the
 * caller's business, and "start a flow" and "send a test broadcast" have
 * nothing else in common.
 */
export type PickableContact = { id: string; username: string | null; name: string | null };

export function ContactPicker({
  /** Resets the search whenever it flips to true (the dialog opening). */
  active,
  value,
  onChange,
  search,
  label = "Buscar contato por username",
}: {
  active: boolean;
  value: PickableContact | null;
  onChange: (c: PickableContact | null) => void;
  search: (q: string) => Promise<PickableContact[]>;
  label?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickableContact[]>([]);
  const [searching, setSearching] = useState(false);

  // Reset on open so the next test starts from a blank search.
  useEffect(() => {
    if (!active) return;
    setQ("");
    setResults([]);
    onChange(null);
    // onChange is a caller's setter; re-running on its identity would clear
    // the pick on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Debounced lookup; a stale response never overwrites a newer query.
  useEffect(() => {
    if (!active) return;
    const needle = q.trim();
    if (!needle) {
      setResults([]);
      return;
    }
    let live = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const found = await search(needle);
        if (live) setResults(found);
      } catch {
        if (live) setResults([]);
      } finally {
        if (live) setSearching(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, active, search]);

  return (
    <>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onChange(null);
          }}
          placeholder="@username"
          aria-label={label}
          className="pl-8"
          autoFocus
        />
        {searching && (
          <Loader2
            className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-neutral-400"
            aria-hidden
          />
        )}
      </div>

      {q.trim() && !searching && results.length === 0 && (
        <p className="text-xs text-neutral-500">Nenhum contato com esse username.</p>
      )}

      {results.length > 0 && (
        <div role="radiogroup" aria-label="Contatos" className="space-y-1">
          {results.map((c) => {
            const active_ = value?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={active_}
                onClick={() => onChange(c)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active_ ? "border-indigo-400 bg-indigo-50" : "border-border hover:bg-accent",
                )}
              >
                <span className="font-medium">@{c.username ?? c.id}</span>
                {c.name && <span className="truncate text-xs text-neutral-500">{c.name}</span>}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/ui/cn";
import { searchContacts, testFlowOnContact } from "../app/flows/[id]/actions";

/**
 * "Testar no meu Instagram": pick a contact by @username, confirm, and the
 * published flow starts for them for real.
 *
 * Real is the point — and the risk. The confirmation step exists because
 * this sends messages to a person, and a takeover abandons whatever
 * conversation they were mid-way through. The dialog also says when the
 * draft differs from what will run, since the runner reads the published
 * graph.
 */
type Contact = { id: string; username: string | null; name: string | null };

export function TestFlowDialog({
  open,
  flowId,
  hasDraft,
  onClose,
  search = searchContacts,
  start = testFlowOnContact,
}: {
  open: boolean;
  flowId: string;
  /** Unpublished edits exist: warn that the test runs the published version. */
  hasDraft: boolean;
  onClose: () => void;
  /** Injectable for tests; default to the server actions. */
  search?: typeof searchContacts;
  start?: typeof testFlowOnContact;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Contact | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);

  // Reset on open so the next test starts from a blank search.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults([]);
    setPicked(null);
  }, [open]);

  // Debounced lookup; a stale response never overwrites a newer query.
  useEffect(() => {
    if (!open) return;
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
  }, [q, open, search]);

  const run = async () => {
    if (!picked) return;
    setStarting(true);
    try {
      const r = await start(flowId, picked.id);
      if (r.ok) {
        toast.success(`Fluxo iniciado para @${picked.username ?? picked.id}.`);
        setConfirming(false);
        onClose();
      } else {
        toast.error("Não foi possível iniciar o teste.", { description: r.error });
        setConfirming(false);
      }
    } catch (err) {
      toast.error("Não foi possível iniciar o teste.", {
        description: err instanceof Error ? err.message : undefined,
      });
      setConfirming(false);
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Testar no meu Instagram</DialogTitle>
            <DialogDescription>
              Escolha um contato que já falou com a conta. O fluxo começa para ele de verdade, do
              primeiro passo.
            </DialogDescription>
          </DialogHeader>

          {hasDraft && (
            <Callout tone="warning">
              Este fluxo tem um rascunho. O teste roda a versão publicada; publique primeiro para
              testar as alterações.
            </Callout>
          )}

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPicked(null);
              }}
              placeholder="@username"
              aria-label="Buscar contato por username"
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
                const active = picked?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPicked(c)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      active ? "border-indigo-400 bg-indigo-50" : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="font-medium">@{c.username ?? c.id}</span>
                    {c.name && <span className="truncate text-xs text-neutral-500">{c.name}</span>}
                  </button>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={!picked} onClick={() => setConfirming(true)}>
              Iniciar teste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Iniciar o fluxo para @${picked?.username ?? ""}?`}
        description="As mensagens são enviadas de verdade pelo Instagram. Se esse contato estiver no meio de outra conversa deste fluxo, ela é encerrada."
        confirmLabel="Iniciar agora"
        pending={starting}
        onConfirm={run}
      />
    </>
  );
}

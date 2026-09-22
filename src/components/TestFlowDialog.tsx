"use client";

import { useState } from "react";
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
import { ContactPicker, type PickableContact } from "@/components/ContactPicker";
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
 *
 * The username lookup itself lives in ContactPicker, shared with the
 * broadcast test dialog.
 */
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
  const [picked, setPicked] = useState<PickableContact | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);

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

          <ContactPicker active={open} value={picked} onChange={setPicked} search={search} />

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

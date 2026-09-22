"use client";

import { useState } from "react";
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
import { withToast } from "@/lib/ui/action-toast";
import type { BroadcastTestDraft } from "../../server/broadcast-test";
import { searchBroadcastTestContacts, testBroadcast } from "./actions";

/**
 * "Enviar um teste": the broadcast equivalent of the flow editor's
 * "Testar no meu Instagram".
 *
 * The draft is read at confirm time, not at open time, so an edit made while
 * the dialog is up is the thing that gets sent.
 */
export function TestBroadcastDialog({
  open,
  onClose,
  draft,
  onSent,
  search = searchBroadcastTestContacts,
  send = testBroadcast,
}: {
  open: boolean;
  onClose: () => void;
  /** The composer's current body + tag, read when the test is confirmed. */
  draft: () => BroadcastTestDraft;
  /** Told who received the test, so the composer can keep saying it. */
  onSent: (contact: PickableContact) => void;
  /** Injectable for tests; default to the server actions. */
  search?: typeof searchBroadcastTestContacts;
  send?: typeof testBroadcast;
}) {
  const [picked, setPicked] = useState<PickableContact | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const run = async () => {
    if (!picked) return;
    const who = `@${picked.username ?? picked.id}`;
    setSending(true);
    try {
      const r = await withToast(() => send(draft(), picked.id), {
        success: `Teste enviado para ${who}. Nenhum contato da lista recebeu.`,
        error: "Não foi possível enviar o teste.",
      });
      setConfirming(false);
      if (r?.ok) {
        onSent(picked);
        onClose();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar um teste</DialogTitle>
            <DialogDescription>
              Escolha a sua própria conta, ou outro contato que já falou com ela. A mensagem sai
              exatamente como o disparo vai sair.
            </DialogDescription>
          </DialogHeader>

          <Callout tone="info">
            O teste vai só para quem você escolher. A lista de destinatários não é tocada e nada
            fica registrado como disparo.
          </Callout>

          <ContactPicker
            active={open}
            value={picked}
            onChange={setPicked}
            search={search}
            label="Buscar contato para o teste"
          />

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button disabled={!picked} onClick={() => setConfirming(true)}>
              Enviar teste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Enviar o teste para @${picked?.username ?? ""}?`}
        description="A mensagem sai de verdade pelo Instagram, para esse contato e mais ninguém. O disparo em si continua onde está."
        confirmLabel="Enviar teste"
        pending={sending}
        onConfirm={run}
      />
    </>
  );
}

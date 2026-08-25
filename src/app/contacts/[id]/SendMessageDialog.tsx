"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { sendMessage } from "./actions";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { withToast } from "@/lib/ui/action-toast";
import { windowState } from "@/lib/ui/window";

/**
 * A single message from the owner to this contact.
 *
 * Inside the 24h window it just sends. Outside, the button still opens the
 * dialog but explains the rule; when the deployment allows HUMAN_AGENT the
 * owner can tick it and the send goes out under that tag (7-day limit,
 * enforced again on the server).
 */
export function SendMessageDialog({
  contactId,
  lastInboundAt,
  subscribed,
  humanAgentAllowed,
}: {
  contactId: string;
  lastInboundAt: string | null;
  subscribed: boolean;
  humanAgentAllowed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [humanAgent, setHumanAgent] = useState(false);
  const [pending, start] = useTransition();

  const state = windowState(lastInboundAt ? new Date(lastInboundAt) : null);
  const outside = state !== "in";
  const canTry = state === "in" || (state === "out" && humanAgentAllowed);

  const submit = () =>
    start(async () => {
      const result = await withToast(() => sendMessage(contactId, text, outside && humanAgent), {
        error: "Não foi possível enviar.",
      });
      if (result === undefined) return;
      setText("");
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} disabled={state === "never"}>
        <Send aria-hidden />
        Enviar mensagem
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar mensagem</DialogTitle>
            <DialogDescription>
              Uma mensagem de texto, enviada agora pela conta conectada.
            </DialogDescription>
          </DialogHeader>

          {!subscribed && (
            <Callout tone="warning">
              Este contato está descadastrado. A mensagem pode ser enviada, mas ele pediu para não
              receber automações.
            </Callout>
          )}

          {outside && (
            <Callout tone={canTry ? "info" : "warning"}>
              {state === "never"
                ? "Este contato nunca escreveu; o Instagram não permite iniciar a conversa."
                : canTry
                  ? "Fora da janela de 24 horas. Marque a opção abaixo para enviar como atendimento humano (tag HUMAN_AGENT, até 7 dias)."
                  : "Fora da janela de 24 horas. Aguarde o contato escrever de novo."}
            </Callout>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="send-text">Mensagem</Label>
            <Textarea
              id="send-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={1000}
              autoFocus
            />
          </div>

          {outside && canTry && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="send-human"
                checked={humanAgent}
                onCheckedChange={(v) => setHumanAgent(v === true)}
              />
              <Label htmlFor="send-human" className="cursor-pointer font-normal">
                Enviar como atendimento humano (HUMAN_AGENT)
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || !text.trim() || !canTry || (outside && !humanAgent)}
            >
              {pending ? "Enviando…" : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

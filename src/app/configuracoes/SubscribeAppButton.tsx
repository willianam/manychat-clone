"use client";

import { useState } from "react";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withToast } from "@/lib/ui/action-toast";
import { subscribeWebhookApp } from "./actions";

/**
 * "Inscrever esta conta".
 *
 * Um botão porque o passo é obrigatório, silencioso quando falta, e até agora
 * só existia como curl no README. A falha chega como `{ ok, error }` e vira
 * toast com a frase que a Meta motivou — não um "falhou" genérico.
 */
export function SubscribeAppButton({
  label = "Inscrever esta conta",
  subscribe = subscribeWebhookApp,
}: {
  label?: string;
  /** Injetável nos testes; por padrão, a server action. */
  subscribe?: typeof subscribeWebhookApp;
}) {
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      await withToast(() => subscribe(), {
        success: "Conta inscrita. A Meta já pode entregar eventos para este app.",
        error: "Não foi possível inscrever a conta.",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button type="button" variant="outline" onClick={run} disabled={running}>
      <Plug aria-hidden />
      {running ? "Inscrevendo…" : label}
    </Button>
  );
}

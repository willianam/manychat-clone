"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { abandonSession } from "./actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { withToast } from "@/lib/ui/action-toast";
import { sessionStatusLabel } from "@/lib/ui/labels";

export type SessionDto = {
  id: string;
  flowId: string;
  flowName: string;
  status: string;
  currentNodeId: string | null;
  startedAt: string;
  resumeAt: string | null;
};

/** Open flow runs for this contact, each with a way out. */
export function Sessions({ contactId, sessions }: { contactId: string; sessions: SessionDto[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<SessionDto | null>(null);

  return (
    <section aria-labelledby="sessions-h" className="rounded-xl border bg-card p-4">
      <h2 id="sessions-h" className="text-sm font-semibold">
        Fluxos em andamento
      </h2>
      {sessions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nenhum fluxo aberto para este contato.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Link
                href={`/flows/${s.flowId}`}
                className="font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {s.flowName}
              </Link>
              <StatusPill tone={s.status === "WAITING_INPUT" ? "warning" : "info"}>
                {sessionStatusLabel(s.status)}
              </StatusPill>
              <span className="text-xs text-muted-foreground">
                desde{" "}
                {new Date(s.startedAt).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
                {s.resumeAt && (
                  <>
                    {" "}
                    · retoma{" "}
                    {new Date(s.resumeAt).toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </>
                )}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={pending}
                onClick={() => setConfirming(s)}
              >
                Abandonar
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={`Abandonar "${confirming?.flowName ?? ""}"?`}
        description="O contato sai do fluxo agora; a próxima mensagem dele volta a passar pelos gatilhos."
        confirmLabel="Abandonar"
        destructive
        pending={pending}
        onConfirm={() => {
          const s = confirming;
          if (!s) return;
          start(async () => {
            const ok = await withToast(() => abandonSession(contactId, s.id).then((r) => r ?? true), {
              success: "Sessão abandonada.",
              error: "Não foi possível abandonar a sessão.",
            });
            setConfirming(null);
            if (ok !== undefined) router.refresh();
          });
        }}
      />
    </section>
  );
}

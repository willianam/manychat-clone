"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Trash2, Users } from "lucide-react";
import { deleteSegmentAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { withToast } from "@/lib/ui/action-toast";

export type SegmentRowData = {
  id: string;
  name: string;
  summary: string;
  ruleCount: number;
  broadcasts: Array<{ id: string; name: string }>;
};

/** One saved segment: what it selects, where it is used, and the ways out. */
export function SegmentRow({ segment }: { segment: SegmentRowData }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const inUse = segment.broadcasts.length > 0;

  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/segmentos/${segment.id}`}
              className="font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {segment.name}
            </Link>
            <p className="mt-0.5 text-sm text-muted-foreground">{segment.summary}</p>
            {inUse && (
              <p className="mt-1 text-xs text-amber-800">
                usado por {segment.broadcasts.length} disparo(s):{" "}
                {segment.broadcasts.map((b) => b.name).join(", ")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button asChild variant="outline" size="sm">
              <Link href={`/contacts?segment=${segment.id}`}>
                <Users aria-hidden />
                Ver contatos
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/segmentos/${segment.id}`}>
                <Pencil aria-hidden />
                Editar
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={inUse || pending}
              title={inUse ? "Em uso por um disparo" : undefined}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden />
              Apagar
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Apagar o segmento "${segment.name}"?`}
        description="Os contatos não mudam; só a definição some. Isso não pode ser desfeito."
        confirmLabel="Apagar"
        destructive
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const ok = await withToast(() => deleteSegmentAction(segment.id).then(() => true), {
              success: "Segmento apagado.",
              error: "Não foi possível apagar.",
            });
            setConfirming(false);
            if (ok !== undefined) router.refresh();
          })
        }
      />
    </li>
  );
}
